import { ItemView, MarkdownRenderer, WorkspaceLeaf, setIcon } from "obsidian";
import type VaultClaudePlugin from "../main";
import type { ChatMessage, ToolCallInfo } from "../agent/agent-service";

export const VIEW_TYPE_CHAT = "vault-claude-chat";

export class ChatView extends ItemView {
  private plugin: VaultClaudePlugin;
  private messagesContainer!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private messages: ChatMessage[] = [];
  private isGenerating = false;
  private currentAssistantEl: HTMLElement | null = null;
  private currentAssistantContent = "";

  constructor(leaf: WorkspaceLeaf, plugin: VaultClaudePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return "Vault Claude";
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("vault-claude-container");

    // Header
    const header = container.createDiv("vault-claude-header");
    header.createEl("h4", { text: "Vault Claude" });

    const headerActions = header.createDiv("vault-claude-header-actions");

    const newChatBtn = headerActions.createEl("button", {
      cls: "vault-claude-icon-btn",
      attr: { "aria-label": "New conversation" },
    });
    setIcon(newChatBtn, "plus");
    newChatBtn.addEventListener("click", () => {
      this.plugin.agentService.clearHistory();
      this.clearChat();
    });

    // Messages area
    this.messagesContainer = container.createDiv("vault-claude-messages");

    // Welcome message
    this.showWelcome();

    // Input area
    const inputArea = container.createDiv("vault-claude-input-area");

    this.inputEl = inputArea.createEl("textarea", {
      cls: "vault-claude-input",
      attr: {
        placeholder: "Ask Claude about your vault...",
        rows: "3",
      },
    });

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    const inputActions = inputArea.createDiv("vault-claude-input-actions");

    // Token counter
    const tokenCounter = inputActions.createDiv("vault-claude-token-counter");
    tokenCounter.id = "vault-claude-tokens";

    this.sendBtn = inputActions.createEl("button", {
      cls: "vault-claude-send-btn",
      text: "Send",
    });
    this.sendBtn.addEventListener("click", () => this.handleSend());
  }

  async onClose() {
    this.plugin.agentService.abort();
  }

  /** Clear the chat display */
  clearChat() {
    this.messages = [];
    this.currentAssistantEl = null;
    this.currentAssistantContent = "";
    this.messagesContainer.empty();
    this.showWelcome();
  }

  private showWelcome() {
    const welcome = this.messagesContainer.createDiv("vault-claude-welcome");
    welcome.createEl("h3", { text: "Welcome to Vault Claude" });
    welcome.createEl("p", {
      text: "Ask me anything about your vault. I can read, search, create, and edit your notes.",
    });

    const suggestions = welcome.createDiv("vault-claude-suggestions");
    const examplePrompts = [
      "Summarize my recent daily notes",
      "What tags do I use most?",
      "Find all notes about...",
      "Create a new note about...",
    ];
    for (const prompt of examplePrompts) {
      const btn = suggestions.createEl("button", {
        cls: "vault-claude-suggestion",
        text: prompt,
      });
      btn.addEventListener("click", () => {
        this.inputEl.value = prompt;
        this.inputEl.focus();
      });
    }
  }

  /** Handle sending a message */
  private async handleSend() {
    const text = this.inputEl.value.trim();
    if (!text || this.isGenerating) return;

    if (!this.plugin.agentService.isReady()) {
      this.addSystemMessage(
        "API key not configured. Go to Settings > Vault Claude to add your Anthropic API key."
      );
      return;
    }

    // Clear welcome on first message
    if (this.messages.length === 0) {
      this.messagesContainer.empty();
    }

    // Add user message
    this.addMessageToUI({ role: "user", content: text, timestamp: Date.now() });
    this.inputEl.value = "";

    // Get active note context if enabled
    let contextNote: { path: string; content: string } | undefined;
    if (this.plugin.settings.autoIncludeActiveNote) {
      const active = this.app.workspace.getActiveFile();
      if (active) {
        const content = await this.app.vault.read(active);
        contextNote = { path: active.path, content };
      }
    }

    // Start generation
    this.isGenerating = true;
    this.sendBtn.setText("Stop");
    this.sendBtn.addClass("vault-claude-stop-btn");
    this.currentAssistantContent = "";
    this.currentAssistantEl = this.createAssistantMessageEl();

    const sendBtnClickStop = () => {
      this.plugin.agentService.abort();
      this.finishGeneration();
    };
    this.sendBtn.addEventListener("click", sendBtnClickStop, { once: true });

    await this.plugin.agentService.sendMessage(text, {
      onToken: (token) => {
        this.currentAssistantContent += token;
        this.renderAssistantMessage();
      },
      onToolCall: (toolCall) => {
        if (this.plugin.settings.showToolCalls) {
          this.addToolCallCard(toolCall);
        }
      },
      onToolResult: (toolCallId, result) => {
        if (this.plugin.settings.showToolCalls) {
          this.updateToolCallCard(toolCallId, result);
        }
      },
      onComplete: (message) => {
        this.messages.push(message);
        this.updateTokenCounter(message.tokenCount);
        this.finishGeneration();
      },
      onError: (error) => {
        this.addSystemMessage(`Error: ${error.message}`);
        this.finishGeneration();
      },
    }, contextNote);

    this.sendBtn.removeEventListener("click", sendBtnClickStop);
  }

  private finishGeneration() {
    this.isGenerating = false;
    this.sendBtn.setText("Send");
    this.sendBtn.removeClass("vault-claude-stop-btn");
    this.currentAssistantEl = null;
  }

  /** Add a message bubble to the UI */
  private addMessageToUI(message: ChatMessage) {
    this.messages.push(message);
    const msgEl = this.messagesContainer.createDiv(
      `vault-claude-message vault-claude-${message.role}`
    );

    const label = msgEl.createDiv("vault-claude-message-label");
    label.setText(message.role === "user" ? "You" : "Claude");

    const contentEl = msgEl.createDiv("vault-claude-message-content");

    if (message.role === "assistant") {
      MarkdownRenderer.render(
        this.app,
        message.content,
        contentEl,
        "",
        this
      );
    } else {
      contentEl.setText(message.content);
    }

    this.scrollToBottom();
  }

  /** Create an empty assistant message element for streaming */
  private createAssistantMessageEl(): HTMLElement {
    const msgEl = this.messagesContainer.createDiv(
      "vault-claude-message vault-claude-assistant"
    );
    const label = msgEl.createDiv("vault-claude-message-label");
    label.setText("Claude");
    msgEl.createDiv("vault-claude-message-content");
    this.scrollToBottom();
    return msgEl;
  }

  /** Re-render the streaming assistant message */
  private renderAssistantMessage() {
    if (!this.currentAssistantEl) return;
    const contentEl = this.currentAssistantEl.querySelector(
      ".vault-claude-message-content"
    ) as HTMLElement;
    if (!contentEl) return;

    contentEl.empty();
    MarkdownRenderer.render(
      this.app,
      this.currentAssistantContent,
      contentEl,
      "",
      this
    );
    this.scrollToBottom();
  }

  /** Add a tool call card to the chat */
  private addToolCallCard(toolCall: ToolCallInfo) {
    const card = this.messagesContainer.createDiv("vault-claude-tool-card");
    card.id = `tool-${toolCall.id}`;

    const header = card.createDiv("vault-claude-tool-header");
    const icon = header.createSpan("vault-claude-tool-icon");
    setIcon(icon, "wrench");
    header.createSpan({ text: ` ${toolCall.name}`, cls: "vault-claude-tool-name" });

    const statusEl = header.createSpan({ cls: "vault-claude-tool-status" });
    statusEl.setText("running...");

    // Show input params (collapsed)
    const inputStr = JSON.stringify(toolCall.input, null, 2);
    if (inputStr.length < 200) {
      card.createDiv({
        cls: "vault-claude-tool-input",
        text: inputStr,
      });
    }

    this.scrollToBottom();
  }

  /** Update a tool call card with the result */
  private updateToolCallCard(toolCallId: string, result: string) {
    const card = this.messagesContainer.querySelector(
      `#tool-${toolCallId}`
    ) as HTMLElement;
    if (!card) return;

    const statusEl = card.querySelector(".vault-claude-tool-status") as HTMLElement;
    if (statusEl) statusEl.setText("done");

    // Add truncated result
    const resultEl = card.createDiv("vault-claude-tool-result");
    const truncated = result.length > 500 ? result.substring(0, 500) + "..." : result;
    resultEl.setText(truncated);
  }

  /** Add a system/error message */
  private addSystemMessage(text: string) {
    const msgEl = this.messagesContainer.createDiv(
      "vault-claude-message vault-claude-system"
    );
    msgEl.setText(text);
    this.scrollToBottom();
  }

  /** Update the token counter display */
  private updateTokenCounter(
    tokenCount?: { input: number; output: number }
  ) {
    if (!this.plugin.settings.showTokenCount || !tokenCount) return;
    const el = this.containerEl.querySelector("#vault-claude-tokens") as HTMLElement;
    if (!el) return;

    const total = tokenCount.input + tokenCount.output;
    el.setText(`${total.toLocaleString()} tokens`);
  }

  private scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}
