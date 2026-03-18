import Anthropic from "@anthropic-ai/sdk";
import type { App } from "obsidian";
import type { VaultClaudeSettings } from "../settings";
import { getObsidianTools, type ToolResult } from "./obsidian-tools";

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
  private client: Anthropic | null = null;
  private conversationHistory: Array<Anthropic.MessageParam> = [];
  private abortController: AbortController | null = null;

  constructor(
    private app: App,
    private settings: VaultClaudeSettings
  ) {}

  /** Initialize or reinitialize the Anthropic client */
  initialize(): void {
    if (!this.settings.apiKey) {
      this.client = null;
      return;
    }
    this.client = new Anthropic({ apiKey: this.settings.apiKey, dangerouslyAllowBrowser: true });
  }

  /** Check if the service is ready to make requests */
  isReady(): boolean {
    return this.client !== null && this.settings.apiKey.length > 0;
  }

  /** Clear conversation history */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /** Abort the current streaming request */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /** Send a message and stream the response with tool use loop */
  async sendMessage(
    userMessage: string,
    callbacks: StreamCallbacks,
    contextNote?: { path: string; content: string }
  ): Promise<void> {
    if (!this.client) {
      callbacks.onError(new Error("API key not configured. Open Settings > Vault Claude to add your key."));
      return;
    }

    this.abortController = new AbortController();

    // Build user content with optional active note context
    let messageContent = userMessage;
    if (contextNote) {
      messageContent = `[Currently viewing: ${contextNote.path}]\n\n---\n${contextNote.content}\n---\n\nUser message: ${userMessage}`;
    }

    this.conversationHistory.push({ role: "user", content: messageContent });

    const tools = getObsidianTools(this.app);
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"],
    }));

    const systemPrompt = this.buildSystemPrompt();

    try {
      await this.agentLoop(anthropicTools, tools, systemPrompt, callbacks);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.abortController = null;
    }
  }

  /** The core agent loop: send message, handle tool calls, repeat until done */
  private async agentLoop(
    anthropicTools: Anthropic.Tool[],
    tools: ReturnType<typeof getObsidianTools>,
    systemPrompt: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    let continueLoop = true;

    while (continueLoop) {
      let fullResponse = "";
      const toolCalls: ToolCallInfo[] = [];

      const stream = this.client!.messages.stream({
        model: this.settings.model,
        max_tokens: this.settings.maxTokens,
        system: systemPrompt,
        messages: this.conversationHistory,
        tools: anthropicTools,
      });

      // Collect the full response
      const response = await stream.finalMessage();

      // Process content blocks
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

          // Execute the tool
          const tool = tools.find((t) => t.name === block.name);
          let result: ToolResult;
          if (tool) {
            try {
              result = await tool.execute(block.input as Record<string, unknown>);
            } catch (err) {
              result = {
                success: false,
                result: `Error: ${err instanceof Error ? err.message : String(err)}`,
              };
            }
          } else {
            result = { success: false, result: `Unknown tool: ${block.name}` };
          }

          toolCall.result = result.result;
          toolCall.status = result.success ? "complete" : "error";
          callbacks.onToolResult(block.id, result.result);
        }
      }

      // If there were tool calls, add assistant message + tool results and loop
      if (response.stop_reason === "tool_use") {
        // Add the assistant's response (with tool_use blocks) to history
        this.conversationHistory.push({ role: "assistant", content: response.content });

        // Add tool results
        const toolResults: Anthropic.ToolResultBlockParam[] = toolCalls.map((tc) => ({
          type: "tool_result" as const,
          tool_use_id: tc.id,
          content: tc.result || "No result",
        }));

        this.conversationHistory.push({ role: "user", content: toolResults });
      } else {
        // end_turn or max_tokens — we're done
        continueLoop = false;

        this.conversationHistory.push({
          role: "assistant",
          content: fullResponse,
        });

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

  /** Build the system prompt with vault context */
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
