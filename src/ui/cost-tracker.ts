/** Token usage and cost tracking per conversation and session */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/** Pricing per million tokens (as of March 2026) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-opus-4-6": { input: 15.00, output: 75.00 },
  // OpenAI
  "gpt-4.1": { input: 2.00, output: 8.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40 },
  "o4-mini": { input: 1.10, output: 4.40 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
};

/** Default pricing for unknown models (conservative estimate) */
const DEFAULT_PRICING = { input: 3.00, output: 15.00 };

/** Ollama models are free (local inference) */
const OLLAMA_FREE = { input: 0, output: 0 };

export class CostTracker {
  private conversationUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private sessionUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private messageCount = 0;

  /** Record token usage from a response */
  addUsage(input: number, output: number): void {
    this.conversationUsage.inputTokens += input;
    this.conversationUsage.outputTokens += output;
    this.sessionUsage.inputTokens += input;
    this.sessionUsage.outputTokens += output;
    this.messageCount++;
  }

  /** Reset conversation-level tracking (on new conversation) */
  resetConversation(): void {
    this.conversationUsage = { inputTokens: 0, outputTokens: 0 };
    this.messageCount = 0;
  }

  /** Get conversation token usage */
  getConversationUsage(): TokenUsage {
    return { ...this.conversationUsage };
  }

  /** Get total session usage (since plugin load) */
  getSessionUsage(): TokenUsage {
    return { ...this.sessionUsage };
  }

  /** Estimate cost for given usage and model */
  estimateCost(usage: TokenUsage, model: string, isOllama = false): CostEstimate {
    const pricing = isOllama ? OLLAMA_FREE : (MODEL_PRICING[model] || DEFAULT_PRICING);
    const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  /** Get a formatted summary string for display */
  getConversationSummary(model: string, isOllama = false): string {
    const usage = this.conversationUsage;
    const total = usage.inputTokens + usage.outputTokens;
    if (total === 0) return "";

    if (isOllama) return `${total.toLocaleString()} tokens (local)`;

    const cost = this.estimateCost(usage, model);
    return `${total.toLocaleString()} tokens (~$${cost.totalCost.toFixed(4)})`;
  }

  /** Get detailed breakdown string */
  getDetailedSummary(model: string, isOllama = false): string {
    const usage = this.conversationUsage;
    const cost = this.estimateCost(usage, model, isOllama);
    const lines = [
      `Messages: ${this.messageCount}`,
      `Input: ${usage.inputTokens.toLocaleString()} tokens (~$${cost.inputCost.toFixed(4)})`,
      `Output: ${usage.outputTokens.toLocaleString()} tokens (~$${cost.outputCost.toFixed(4)})`,
      `Total: ~$${cost.totalCost.toFixed(4)}`,
    ];
    return lines.join("\n");
  }

  /** Set pricing for an OpenRouter model dynamically */
  static setModelPricing(modelId: string, inputPerMillion: number, outputPerMillion: number): void {
    MODEL_PRICING[modelId] = { input: inputPerMillion, output: outputPerMillion };
  }
}
