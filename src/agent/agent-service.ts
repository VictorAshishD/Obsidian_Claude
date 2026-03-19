import Anthropic from "@anthropic-ai/sdk";
import { FileSystemAdapter, type App } from "obsidian";
import type { VaultClaudeSettings } from "../settings";
import { getObsidianTools, type ToolResult } from "./obsidian-tools";
import {
  OpenRouterClient,
  toOpenRouterTools,
  type ORMessage,
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

    const provider = this.settings.authProvider;

    // CLI mode doesn't need an API key
    if (provider === "claude-cli") return;

    // Ollama doesn't need an API key
    if (provider === "ollama") {
      this.openRouterClient = OpenRouterClient.forOllama(
        this.settings.model,
        this.settings.maxTokens,
        this.settings.ollamaUrl ? `${this.settings.ollamaUrl}/v1` : undefined
      );
      return;
    }

    if (!this.settings.apiKey) return;

    if (provider === "openrouter") {
      this.openRouterClient = OpenRouterClient.forOpenRouter(
        this.settings.apiKey,
        this.settings.model,
        this.settings.maxTokens
      );
    } else if (provider === "openai") {
      this.openRouterClient = OpenRouterClient.forOpenAI(
        this.settings.apiKey,
        this.settings.model,
        this.settings.maxTokens
      );
    } else {
      // anthropic
      this.anthropicClient = new Anthropic({
        apiKey: this.settings.apiKey,
        dangerouslyAllowBrowser: true,
      });
    }
  }

  isReady(): boolean {
    const provider = this.settings.authProvider;
    if (provider === "claude-cli") return true;
    if (provider === "ollama") return this.openRouterClient !== null;
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

  /** Send a message — routes to the correct provider */
  async sendMessage(
    userMessage: string,
    callbacks: StreamCallbacks,
    contextNote?: { path: string; content: string },
    useLightModel?: boolean
  ): Promise<void> {
    if (!this.isReady()) {
      callbacks.onError(
        new Error("API key not configured. Open Settings > Obsidian Claude to add your key.")
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

    // Two-tiered model: resolve which model to use
    const effectiveModel = useLightModel && this.settings.lightModel
      ? this.settings.lightModel
      : this.settings.model;

    try {
      const provider = this.settings.authProvider;
      if (provider === "claude-cli") {
        await this.cliLoop(messageContent, systemPrompt, callbacks, effectiveModel);
      } else if (provider === "openrouter" || provider === "openai" || provider === "ollama") {
        await this.openRouterLoop(messageContent, tools, systemPrompt, callbacks, effectiveModel);
      } else {
        await this.anthropicLoop(messageContent, tools, systemPrompt, callbacks, effectiveModel);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.abortController = null;
    }
  }

  // ===== ANTHROPIC PATH (real streaming) =====

  private async anthropicLoop(
    userMessage: string,
    tools: ReturnType<typeof getObsidianTools>,
    systemPrompt: string,
    callbacks: StreamCallbacks,
    effectiveModel?: string
  ): Promise<void> {
    this.conversationHistory.push({ role: "user", content: userMessage });
    this.trimHistory(this.conversationHistory);

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
        model: effectiveModel || this.settings.model,
        max_tokens: this.settings.maxTokens,
        system: systemPrompt,
        messages: this.conversationHistory,
        tools: anthropicTools,
      });

      // Stream tokens as they arrive
      stream.on("text", (text) => {
        fullResponse += text;
        callbacks.onToken(text);
      });

      // Wait for the full message (tool calls only available after completion)
      const response = await stream.finalMessage();

      // Process tool_use blocks (text was already streamed above)
      for (const block of response.content) {
        if (block.type === "tool_use") {
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

  // ===== OPENROUTER / OPENAI / OLLAMA PATH (streaming) =====

  private async openRouterLoop(
    userMessage: string,
    tools: ReturnType<typeof getObsidianTools>,
    systemPrompt: string,
    callbacks: StreamCallbacks,
    effectiveModel?: string
  ): Promise<void> {
    // Ensure system prompt is first message
    if (this.orConversationHistory.length === 0) {
      this.orConversationHistory.push({ role: "system", content: systemPrompt });
    }

    this.orConversationHistory.push({ role: "user", content: userMessage });
    this.trimORHistory();

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
      const client = this.createClientForModel(effectiveModel || this.settings.model);
      const toolCalls: ToolCallInfo[] = [];

      // Use streaming for text delivery
      const response = await client.chatStream(
        this.orConversationHistory,
        orTools,
        {
          onToken: (token) => callbacks.onToken(token),
          onToolCalls: () => { /* handled below from response */ },
          onDone: () => { /* handled below */ },
        },
        this.abortController?.signal
      );

      if (response.usage) {
        totalInputTokens += response.usage.prompt_tokens;
        totalOutputTokens += response.usage.completion_tokens;
      }

      const choice = response.choices[0];
      if (!choice) {
        callbacks.onError(new Error("No response from API"));
        return;
      }

      const assistantMsg = choice.message;

      // Handle tool calls
      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
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
    callbacks: StreamCallbacks,
    effectiveModel?: string
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : ".";

    const options: {
      cwd: string;
      model?: string;
      maxTurns: number;
      systemPrompt?: string;
    } = {
      cwd: vaultPath,
      maxTurns: this.settings.cliMaxTurns || 10,
    };

    const modelToUse = effectiveModel || this.settings.model;
    if (modelToUse) {
      options.model = modelToUse;
    }

    if (this.settings.systemPrompt.trim()) {
      options.systemPrompt = systemPrompt;
    }

    const response = await sendCLIMessage(userMessage, options);

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

  /** Create the correct client type for the current provider and given model */
  private createClientForModel(model: string): OpenRouterClient {
    const provider = this.settings.authProvider;
    if (provider === "ollama") {
      return OpenRouterClient.forOllama(model, this.settings.maxTokens,
        this.settings.ollamaUrl ? `${this.settings.ollamaUrl}/v1` : undefined);
    } else if (provider === "openai") {
      return OpenRouterClient.forOpenAI(this.settings.apiKey, model, this.settings.maxTokens);
    } else {
      return OpenRouterClient.forOpenRouter(this.settings.apiKey, model, this.settings.maxTokens);
    }
  }

  /** Trim Anthropic conversation history to stay within limit */
  private trimHistory(history: Array<Anthropic.MessageParam>): void {
    const limit = this.settings.conversationHistoryLimit || 50;
    // Each exchange is 2 entries (user + assistant), keep at least the latest messages
    while (history.length > limit * 2) {
      history.shift();
    }
  }

  /** Trim OpenRouter conversation history, preserving the system message */
  private trimORHistory(): void {
    const limit = this.settings.conversationHistoryLimit || 50;
    const maxEntries = limit * 2 + 1; // +1 for system message
    while (this.orConversationHistory.length > maxEntries) {
      // Always keep index 0 (system message)
      this.orConversationHistory.splice(1, 1);
    }
  }

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
      `You are Obsidian Claude, an AI assistant embedded in the Obsidian note-taking app. ` +
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
