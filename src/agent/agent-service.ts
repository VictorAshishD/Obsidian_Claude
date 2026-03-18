import Anthropic from "@anthropic-ai/sdk";
import type { App } from "obsidian";
import type { VaultClaudeSettings } from "../settings";
import { getObsidianTools, type ToolResult } from "./obsidian-tools";
import {
  OpenRouterClient,
  toOpenRouterTools,
  type ORMessage,
  type ORToolCall,
} from "./openrouter-client";
import { sendCLIMessage } from "./claude-cli-client";

// --- Types ---

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  tokenCount?: { input: number; output: number };
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  status: "running" | "complete" | "error";
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCall: (toolCall: ToolCallInfo) => void;
  onToolResult: (toolCallId: string, result: string) => void;
  onComplete: (message: ChatMessage) => void;
  onError: (error: Error) => void;
}

// --- Service ---

export class AgentService {
  private anthropicClient: Anthropic | null = null;
  private openRouterClient: OpenRouterClient | null = null;
  private conversationHistory: Array<Anthropic.MessageParam> = [];
  private orConversationHistory: ORMessage[] = [];
  private abortController: AbortController | null = null;

  constructor(
    private app: App,
    private settings: VaultClaudeSettings
  ) {}

  /** Initialize or reinitialize the API client */
  initialize(): void {
    this.anthropicClient = null;
    this.openRouterClient = null;

    // CLI mode doesn't need an API key
    if (this.settings.authProvider === "claude-cli") return;

    if (!this.settings.apiKey) return;

    if (this.settings.authProvider === "openrouter") {
      this.openRouterClient = new OpenRouterClient(
        this.settings.apiKey,
        this.settings.model,
        this.settings.maxTokens
      );
    } else {
      this.anthropicClient = new Anthropic({
        apiKey: this.settings.apiKey,
        dangerouslyAllowBrowser: true,
      });
    }
  }

  isReady(): boolean {
    if (this.settings.authProvider === "claude-cli") return true;
    return (
      this.settings.apiKey.length > 0 &&
      (this.anthropicClient !== null || this.openRouterClient !== null)
    );
  }

  clearHistory(): void {
    this.conversationHistory = [];
    this.orConversationHistory = [];
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /** Send a message — routes to Anthropic or OpenRouter based on provider */
  async sendMessage(
    userMessage: string,
    callbacks: StreamCallbacks,
    contextNote?: { path: string; content: string }
  ): Promise<void> {
    if (!this.isReady()) {
      callbacks.onError(
        new Error("API key not configured. Open Settings > Vault Claude to add your key.")
      );
      return;
    }

    this.abortController = new AbortController();

    let messageContent = userMessage;
    if (contextNote) {
      messageContent = `[Currently viewing: ${contextNote.path}]\n\n---\n${contextNote.content}\n---\n\nUser message: ${userMessage}`;
    }

    const tools = getObsidianTools(this.app);
    const systemPrompt = this.buildSystemPrompt();

    try {
      if (this.settings.authProvider === "claude-cli") {
        await this.cliLoop(messageContent, systemPrompt, callbacks);
      } else if (this.settings.authProvider === "openrouter") {
        await this.openRouterLoop(messageContent, tools, systemPrompt, callbacks);
      } else {
        await this.anthropicLoop(messageContent, tools, systemPrompt, callbacks);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.abortController = null;
    }
  }

  // ===== ANTHROPIC PATH =====

  private async anthropicLoop(
    userMessage: string,
    tools: ReturnType<typeof getObsidianTools>,
    systemPrompt: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    this.conversationHistory.push({ role: "user", content: userMessage });

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"],
    }));

    let continueLoop = true;

    while (continueLoop) {
      let fullResponse = "";
      const toolCalls: ToolCallInfo[] = [];

      const stream = this.anthropicClient!.messages.stream({
        model: this.settings.model,
        max_tokens: this.settings.maxTokens,
        system: systemPrompt,
        messages: this.conversationHistory,
        tools: anthropicTools,
      });

      const response = await stream.finalMessage();

      for (const block of response.content) {
        if (block.type === "text") {
          fullResponse += block.text;
          callbacks.onToken(block.text);
        } else if (block.type === "tool_use") {
          const toolCall: ToolCallInfo = {
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
            status: "running",
          };
          toolCalls.push(toolCall);
          callbacks.onToolCall(toolCall);

          const result = await this.executeTool(tools, block.name, block.input as Record<string, unknown>);
          toolCall.result = result.result;
          toolCall.status = result.success ? "complete" : "error";
          callbacks.onToolResult(block.id, result.result);
        }
      }

      if (response.stop_reason === "tool_use") {
        this.conversationHistory.push({ role: "assistant", content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = toolCalls.map((tc) => ({
          type: "tool_result" as const,
          tool_use_id: tc.id,
          content: tc.result || "No result",
        }));
        this.conversationHistory.push({ role: "user", content: toolResults });
      } else {
        continueLoop = false;
        this.conversationHistory.push({ role: "assistant", content: fullResponse });
        callbacks.onComplete({
          role: "assistant",
          content: fullResponse,
          timestamp: Date.now(),
          tokenCount: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
          },
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
    }
  }

  // ===== OPENROUTER PATH (OpenAI format) =====

  private async openRouterLoop(
    userMessage: string,
    tools: ReturnType<typeof getObsidianTools>,
    systemPrompt: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    // Ensure system prompt is first message
    if (this.orConversationHistory.length === 0) {
      this.orConversationHistory.push({ role: "system", content: systemPrompt });
    }

    this.orConversationHistory.push({ role: "user", content: userMessage });

    const orTools = toOpenRouterTools(
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Record<string, unknown>,
      }))
    );

    let continueLoop = true;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (continueLoop) {
      // Recreate client each iteration in case model changed
      const client = new OpenRouterClient(
        this.settings.apiKey,
        this.settings.model,
        this.settings.maxTokens
      );

      const response = await client.chat(this.orConversationHistory, orTools);

      if (response.usage) {
        totalInputTokens += response.usage.prompt_tokens;
        totalOutputTokens += response.usage.completion_tokens;
      }

      const choice = response.choices[0];
      if (!choice) {
        callbacks.onError(new Error("No response from OpenRouter"));
        return;
      }

      const assistantMsg = choice.message;
      const toolCalls: ToolCallInfo[] = [];

      // Handle text content
      if (assistantMsg.content) {
        callbacks.onToken(assistantMsg.content);
      }

      // Handle tool calls
      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        // Add assistant message with tool_calls to history
        this.orConversationHistory.push({
          role: "assistant",
          content: assistantMsg.content || null,
          tool_calls: assistantMsg.tool_calls,
        });

        for (const tc of assistantMsg.tool_calls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments);
          } catch {
            parsedArgs = {};
          }

          const toolCall: ToolCallInfo = {
            id: tc.id,
            name: tc.function.name,
            input: parsedArgs,
            status: "running",
          };
          toolCalls.push(toolCall);
          callbacks.onToolCall(toolCall);

          const result = await this.executeTool(tools, tc.function.name, parsedArgs);
          toolCall.result = result.result;
          toolCall.status = result.success ? "complete" : "error";
          callbacks.onToolResult(tc.id, result.result);

          // Add tool result to history
          this.orConversationHistory.push({
            role: "tool",
            content: result.result,
            tool_call_id: tc.id,
          });
        }

        // Continue the loop for the model to respond to tool results
      } else {
        // No tool calls — we're done
        continueLoop = false;

        this.orConversationHistory.push({
          role: "assistant",
          content: assistantMsg.content || "",
        });

        callbacks.onComplete({
          role: "assistant",
          content: assistantMsg.content || "",
          timestamp: Date.now(),
          tokenCount: {
            input: totalInputTokens,
            output: totalOutputTokens,
          },
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
    }
  }

  // ===== CLAUDE CODE CLI PATH =====

  private async cliLoop(
    userMessage: string,
    systemPrompt: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    // The CLI handles its own tool execution (file reads, writes, bash, etc.)
    // We just send the prompt and get back the final result.
    // The vault path is set as cwd so the CLI operates on vault files.

    const vaultPath = (this.app.vault.adapter as any).basePath || ".";

    const options: {
      cwd: string;
      model?: string;
      maxTurns: number;
      systemPrompt?: string;
    } = {
      cwd: vaultPath,
      maxTurns: this.settings.cliMaxTurns || 10,
    };

    if (this.settings.model) {
      options.model = this.settings.model;
    }

    if (this.settings.systemPrompt.trim()) {
      options.systemPrompt = systemPrompt;
    }

    const response = await sendCLIMessage(userMessage, options);

    // Send the full response at once (CLI doesn't support token-by-token streaming to us)
    callbacks.onToken(response.content);

    callbacks.onComplete({
      role: "assistant",
      content: response.content,
      timestamp: Date.now(),
      tokenCount:
        response.inputTokens > 0 || response.outputTokens > 0
          ? { input: response.inputTokens, output: response.outputTokens }
          : undefined,
    });
  }

  // ===== SHARED =====

  private async executeTool(
    tools: ReturnType<typeof getObsidianTools>,
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return { success: false, result: `Unknown tool: ${name}` };
    }
    try {
      return await tool.execute(input);
    } catch (err) {
      return {
        success: false,
        result: `Error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private buildSystemPrompt(): string {
    const vaultName = this.app.vault.getName();
    const parts: string[] = [];

    parts.push(
      `You are Vault Claude, an AI assistant embedded in the Obsidian note-taking app. ` +
        `You have access to the user's vault "${vaultName}" through specialized tools. ` +
        `You can read, write, search, and analyze notes in the vault.\n\n` +
        `Guidelines:\n` +
        `- Use the provided tools to interact with the vault — do not guess file contents.\n` +
        `- When editing files, preserve existing frontmatter and formatting.\n` +
        `- Use [[wikilinks]] when referencing other notes.\n` +
        `- Be concise but thorough. Show your work when using tools.\n` +
        `- If a file doesn't exist, say so rather than fabricating content.\n` +
        `- Respect Obsidian conventions: YAML frontmatter, markdown formatting, folder structure.`
    );

    if (this.settings.systemPrompt.trim()) {
      parts.push(`\nAdditional instructions from the user:\n${this.settings.systemPrompt}`);
    }

    return parts.join("\n");
  }
}
