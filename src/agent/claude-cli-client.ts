/**
 * Claude Code CLI wrapper.
 * Spawns `claude` as a subprocess using the `-p` (print) flag with
 * `--output-format stream-json` for structured streaming output.
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
}

/**
 * Detect if Claude Code CLI is installed and authenticated.
 * Returns info about the installation status.
 */
export async function detectClaudeCLI(): Promise<CLIDetectionResult> {
  try {
    // Try to find claude binary
    const whichCmd = process.platform === "win32" ? "where claude" : "which claude";
    const { stdout: pathOut } = await execAsync(whichCmd);
    const cliPath = pathOut.trim().split("\n")[0].trim();

    // Get version
    const { stdout: versionOut } = await execAsync("claude --version");
    const version = versionOut.trim();

    // Check auth status by running a minimal command
    // If not authenticated, claude will error
    try {
      await execAsync('claude -p "test" --max-turns 1 --output-format json', {
        timeout: 15000,
      });
      return { found: true, path: cliPath, version, authenticated: true };
    } catch {
      // Could be auth failure or other issue — still detected
      return {
        found: true,
        path: cliPath,
        version,
        authenticated: false,
        error: "CLI found but authentication may have expired. Run `claude login` in your terminal.",
      };
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

  // Print mode (non-interactive)
  args.push("-p");

  // Output as JSON for structured parsing
  args.push("--output-format", "json");

  // Model override
  if (options.model) {
    args.push("--model", options.model);
  }

  // Max turns (limit agentic loops)
  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }

  // Allowed tools
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  // System prompt via --append-system-prompt
  if (options.systemPrompt) {
    args.push("--append-system-prompt", options.systemPrompt);
  }

  // The prompt itself (must be last, passed as the -p argument value)
  // We need to escape it for shell safety
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');

  const fullCommand = `claude ${args.join(" ")} "${escapedPrompt}"`;

  try {
    const { stdout } = await execAsync(fullCommand, {
      cwd: options.cwd,
      timeout: 300000, // 5 minute timeout for complex operations
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      env: {
        ...process.env,
        // Ensure Claude Code doesn't try to open a browser
        CLAUDE_CODE_NO_BROWSER: "1",
      },
    });

    // Parse JSON output
    try {
      const parsed = JSON.parse(stdout);

      // The JSON output format from claude -p --output-format json
      // returns: { result: string, cost_usd: number, ... }
      // or sometimes just the text result
      if (typeof parsed === "object" && parsed !== null) {
        return {
          content: parsed.result || parsed.text || JSON.stringify(parsed),
          inputTokens: parsed.usage?.input_tokens || parsed.input_tokens || 0,
          outputTokens: parsed.usage?.output_tokens || parsed.output_tokens || 0,
        };
      }

      return { content: String(parsed), inputTokens: 0, outputTokens: 0 };
    } catch {
      // If not valid JSON, return raw stdout
      return { content: stdout.trim(), inputTokens: 0, outputTokens: 0 };
    }
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const errMsg = error.stderr || error.message || "Unknown CLI error";

    // Check for common errors
    if (errMsg.includes("not authenticated") || errMsg.includes("login")) {
      throw new Error(
        "Claude Code is not authenticated. Run `claude login` in your terminal first."
      );
    }
    if (errMsg.includes("ENOENT") || errMsg.includes("not found") || errMsg.includes("not recognized")) {
      throw new Error(
        "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
      );
    }

    throw new Error(`Claude Code CLI error: ${errMsg}`);
  }
}
