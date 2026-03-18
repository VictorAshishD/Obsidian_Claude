/**
 * OpenRouter client using the OpenAI chat completions format.
 * OpenRouter doesn't support the Anthropic API format natively,
 * so we use their OpenAI-compatible endpoint instead.
 */

import { requestUrl } from "obsidian";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

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

export class OpenRouterClient {
  constructor(
    private apiKey: string,
    private model: string,
    private maxTokens: number
  ) {}

  /** Send a chat completion request to OpenRouter */
  async chat(
    messages: ORMessage[],
    tools?: ORToolDef[]
  ): Promise<ORResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await requestUrl({
      url: `${OPENROUTER_BASE}/chat/completions`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://obsidian.md",
        "X-Title": "Obsidian Claude",
      },
      body: JSON.stringify(body),
    });

    if (response.status !== 200) {
      const errBody = response.json;
      const errMsg = errBody?.error?.message || `HTTP ${response.status}`;
      throw new Error(`OpenRouter API error: ${errMsg}`);
    }

    return response.json as ORResponse;
  }
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
