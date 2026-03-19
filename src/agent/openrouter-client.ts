/**
 * OpenAI-compatible chat completions client.
 * Used for OpenRouter, OpenAI, Ollama, and any provider
 * that implements the OpenAI chat completions format.
 */

import { requestUrl } from "obsidian";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const OLLAMA_BASE = "http://localhost:11434/v1";

// --- Types matching OpenAI chat completions format ---

export interface ORToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ORMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ORToolCall[];
  tool_call_id?: string;
}

export interface ORToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ORChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: ORToolCall[];
  };
  finish_reason: "stop" | "tool_calls" | "length" | null;
}

export interface ORResponse {
  id: string;
  choices: ORChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Streaming callback for token-by-token delivery */
export interface StreamCallback {
  onToken: (token: string) => void;
  onToolCalls: (toolCalls: ORToolCall[]) => void;
  onDone: (usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
}

export class OpenRouterClient {
  private baseUrl: string;
  private extraHeaders: Record<string, string>;

  constructor(
    private apiKey: string,
    private model: string,
    private maxTokens: number,
    options?: { baseUrl?: string; extraHeaders?: Record<string, string> }
  ) {
    this.baseUrl = options?.baseUrl || OPENROUTER_BASE;
    this.extraHeaders = options?.extraHeaders || {};
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private buildBody(messages: ORMessage[], tools?: ORToolDef[], stream = false): string {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    if (stream) {
      body.stream = true;
    }
    return JSON.stringify(body);
  }

  /** Send a non-streaming chat completion request (used as fallback) */
  async chat(
    messages: ORMessage[],
    tools?: ORToolDef[]
  ): Promise<ORResponse> {
    const response = await requestUrl({
      url: `${this.baseUrl}/chat/completions`,
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildBody(messages, tools),
    });

    if (response.status !== 200) {
      const errBody = response.json;
      const errMsg = errBody?.error?.message || `HTTP ${response.status}`;
      throw new Error(`API error: ${errMsg}`);
    }

    return response.json as ORResponse;
  }

  /** Stream a chat completion — delivers tokens via callback, returns full message when done */
  async chatStream(
    messages: ORMessage[],
    tools: ORToolDef[] | undefined,
    callbacks: StreamCallback,
    signal?: AbortSignal
  ): Promise<ORResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildBody(messages, tools, true),
      signal,
    });

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        errMsg = errBody?.error?.message || errMsg;
      } catch { /* ignore parse error */ }
      throw new Error(`API error: ${errMsg}`);
    }

    // Parse SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body for streaming");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    const toolCalls: Map<number, ORToolCall> = new Map();
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;

            if (delta?.content) {
              fullContent += delta.content;
              callbacks.onToken(delta.content);
            }

            // Accumulate streamed tool calls
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, {
                    id: tc.id || "",
                    type: "function",
                    function: { name: tc.function?.name || "", arguments: "" },
                  });
                }
                const existing = toolCalls.get(idx)!;
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.function.name = tc.function.name;
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
              }
            }

            // Capture usage from final chunk (some providers include it)
            if (chunk.usage) {
              usage = chunk.usage;
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCallsArr = toolCalls.size > 0 ? Array.from(toolCalls.values()) : undefined;
    if (toolCallsArr) {
      callbacks.onToolCalls(toolCallsArr);
    }
    callbacks.onDone(usage);

    // Return a synthetic ORResponse matching the non-streaming format
    return {
      id: "",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: fullContent || null,
          tool_calls: toolCallsArr,
        },
        finish_reason: toolCallsArr ? "tool_calls" : "stop",
      }],
      usage,
    };
  }

  /** Create a client for OpenRouter */
  static forOpenRouter(apiKey: string, model: string, maxTokens: number): OpenRouterClient {
    return new OpenRouterClient(apiKey, model, maxTokens, {
      baseUrl: OPENROUTER_BASE,
      extraHeaders: {
        "HTTP-Referer": "https://obsidian.md",
        "X-Title": "Vault Claude",
      },
    });
  }

  /** Create a client for OpenAI */
  static forOpenAI(apiKey: string, model: string, maxTokens: number): OpenRouterClient {
    return new OpenRouterClient(apiKey, model, maxTokens, {
      baseUrl: OPENAI_BASE,
    });
  }

  /** Create a client for Ollama (local, no API key) */
  static forOllama(model: string, maxTokens: number, baseUrl?: string): OpenRouterClient {
    return new OpenRouterClient("", model, maxTokens, {
      baseUrl: baseUrl || OLLAMA_BASE,
    });
  }
}

/** Fetch available models from Ollama */
export async function fetchOllamaModels(baseUrl?: string): Promise<Array<{ name: string; size: number }>> {
  const url = baseUrl || "http://localhost:11434";
  const response = await requestUrl({
    url: `${url}/api/tags`,
    method: "GET",
  });
  const data = response.json;
  if (!data?.models || !Array.isArray(data.models)) {
    throw new Error("Could not fetch Ollama models. Is Ollama running?");
  }
  return data.models;
}

/** Convert our Obsidian tools to OpenAI function format */
export function toOpenRouterTools(
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>
): ORToolDef[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}
