/**
 * Claude Code CLI wrapper.
 * Spawns `claude` as a subprocess using the `-p` (print) flag with
 * `--output-format json` for structured output.
 *
 * This uses the user's existing Claude Code authentication — no API key needed.
 * The user must have Claude Code installed and authenticated (`claude login`).
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface CLIDetectionResult {
  found: boolean;
  path?: string;
  version?: string;
  authenticated?: boolean;
  error?: string;
}

export interface CLIResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model?: string;
  sessionId?: string;
  numTurns?: number;
}

/**
 * Detect if Claude Code CLI is installed and authenticated.
 * Uses `claude auth status` (no API call, no cost) to check auth.
 */
export async function detectClaudeCLI(): Promise<CLIDetectionResult> {
  try {
    // Try to find claude binary
    const whichCmd = process.platform === "win32" ? "where claude" : "which claude";
    const { stdout: pathOut } = await execAsync(whichCmd, { timeout: 5000 });
    const cliPath = pathOut.trim().split("\n")[0].trim();

    // Get version
    const { stdout: versionOut } = await execAsync("claude --version", { timeout: 5000 });
    const version = versionOut.trim();

    // Check auth by looking for config files or running a no-cost check
    // `claude config list` succeeds if the CLI is configured
    try {
      await execAsync("claude config list", { timeout: 10000 });
      return { found: true, path: cliPath, version, authenticated: true };
    } catch {
      // Config list failed — try checking if we can at least invoke it
      // (the CLI itself shows auth status on stderr when not authed)
      try {
        await execAsync('claude -p "hi" --max-turns 0 --output-format json', {
          timeout: 20000,
        });
        return { found: true, path: cliPath, version, authenticated: true };
      } catch (authErr: unknown) {
        const errMsg = (authErr as { stderr?: string }).stderr || "";
        if (errMsg.includes("not authenticated") || errMsg.includes("login") || errMsg.includes("unauthorized")) {
          return {
            found: true,
            path: cliPath,
            version,
            authenticated: false,
            error: "CLI found but not authenticated. Run `claude login` in your terminal.",
          };
        }
        // If it errored for other reasons but the binary exists, assume it works
        return { found: true, path: cliPath, version, authenticated: true };
      }
    }
  } catch {
    return {
      found: false,
      error: "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
    };
  }
}

/**
 * Send a prompt to Claude Code CLI and get the response.
 * Uses `-p` (print mode) for non-interactive use.
 */
export async function sendCLIMessage(
  prompt: string,
  options: {
    cwd?: string;
    model?: string;
    maxTurns?: number;
    allowedTools?: string[];
    systemPrompt?: string;
  } = {}
): Promise<CLIResponse> {
  const args: string[] = [];

  args.push("-p");
  args.push("--output-format", "json");

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  if (options.systemPrompt) {
    args.push("--append-system-prompt", options.systemPrompt);
  }

  // Escape prompt for shell safety
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const fullCommand = `claude ${args.join(" ")} "${escapedPrompt}"`;

  try {
    const { stdout } = await execAsync(fullCommand, {
      cwd: options.cwd,
      timeout: 300000, // 5 min
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: {
        ...process.env,
        CLAUDE_CODE_NO_BROWSER: "1",
      },
    });

    try {
      const parsed = JSON.parse(stdout);

      if (typeof parsed === "object" && parsed !== null) {
        // Extract token usage from the detailed modelUsage field
        let inputTokens = 0;
        let outputTokens = 0;
        if (parsed.modelUsage) {
          for (const modelData of Object.values(parsed.modelUsage) as Array<Record<string, number>>) {
            inputTokens += (modelData.inputTokens || 0) + (modelData.cacheReadInputTokens || 0) + (modelData.cacheCreationInputTokens || 0);
            outputTokens += modelData.outputTokens || 0;
          }
        } else if (parsed.usage) {
          inputTokens = (parsed.usage.input_tokens || 0) + (parsed.usage.cache_read_input_tokens || 0);
          outputTokens = parsed.usage.output_tokens || 0;
        }

        return {
          content: parsed.result || parsed.text || JSON.stringify(parsed),
          inputTokens,
          outputTokens,
          costUsd: parsed.total_cost_usd || 0,
          model: parsed.modelUsage ? Object.keys(parsed.modelUsage)[0] : undefined,
          sessionId: parsed.session_id,
          numTurns: parsed.num_turns,
        };
      }

      return { content: String(parsed), inputTokens: 0, outputTokens: 0, costUsd: 0 };
    } catch {
      return { content: stdout.trim(), inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const errMsg = error.stderr || error.message || "Unknown CLI error";

    if (errMsg.includes("not authenticated") || errMsg.includes("login")) {
      throw new Error("Claude Code is not authenticated. Run `claude login` in your terminal first.");
    }
    if (errMsg.includes("ENOENT") || errMsg.includes("not found") || errMsg.includes("not recognized")) {
      throw new Error("Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code");
    }

    throw new Error(`Claude Code CLI error: ${errMsg}`);
  }
}
