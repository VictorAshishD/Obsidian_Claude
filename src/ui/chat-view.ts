import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type VaultClaudePlugin from "../main";
import type { ChatMessage, ToolCallInfo } from "../agent/agent-service";
import { parseSlashCommand, buildSlashCommandPrompt, SLASH_COMMANDS } from "../commands/slash-commands";
import { MentionAutocomplete, type MentionItem } from "./mention-autocomplete";
import { renderDiffCard, type PendingEdit } from "./diff-view";
import { ConversationStore, type SavedConversation, type ConversationMeta } from "../storage/conversation-store";
import type { TFile } from "obsidian";

export const VIEW_TYPE_CHAT = "vault-claude-chat";

export class ChatView extends ItemView {
  private plugin: VaultClaudePlugin;
  private messagesContainer!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private tokenCounterEl!: HTMLElement;
  private mentionTagsEl!: HTMLElement;
  private slashHintEl!: HTMLElement;
  private messages: ChatMessage[] = [];
  private isGenerating = false;
  private currentAssistantEl: HTMLElement | null = null;
  private currentAssistantContent = "";
  private mentionAutocomplete: MentionAutocomplete | null = null;
  private activeMentions: MentionItem[] = [];
  private pendingEdits: PendingEdit[] = [];
  private currentConversationId: string | null = null;

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

    const historyBtn = headerActions.createEl("button", {
      cls: "vault-claude-icon-btn",
      attr: { "aria-label": "Conversation history" },
    });
    setIcon(historyBtn, "clock");
    historyBtn.addEventListener("click", () => this.showConversationList());

    const saveBtn = headerActions.createEl("button", {
      cls: "vault-claude-icon-btn",
      attr: { "aria-label": "Save conversation" },
    });
    setIcon(saveBtn, "save");
    saveBtn.addEventListener("click", () => this.saveConversation());

    const newChatBtn = headerActions.createEl("button", {
      cls: "vault-claude-icon-btn",
      attr: { "aria-label": "New conversation" },
    });
    setIcon(newChatBtn, "plus");
    newChatBtn.addEventListener("click", () => {
      this.plugin.costTracker.resetConversation();
      this.plugin.agentService.clearHistory();
      this.clearChat();
    });

    // Messages area
    this.messagesContainer = container.createDiv("vault-claude-messages");
    this.showWelcome();

    // Input area
    const inputArea = container.createDiv("vault-claude-input-area");

    // Mention tags display
    this.mentionTagsEl = inputArea.createDiv("vault-claude-mention-tags");

    // Slash command hint
    this.slashHintEl = inputArea.createDiv("vault-claude-slash-hint");
    this.slashHintEl.style.display = "none";

    // Input wrapper (for positioning autocomplete dropdown)
    const inputWrapper = inputArea.createDiv("vault-claude-input-wrapper");

    this.inputEl = inputWrapper.createEl("textarea", {
      cls: "vault-claude-input",
      attr: { placeholder: "Ask about your vault... (/ for commands, @ to mention)", rows: "3" },
    });

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
      if (e.key === "Escape" && this.isGenerating) {
        this.plugin.agentService.abort();
        this.finishGeneration();
      }
    });

    this.inputEl.addEventListener("input", () => this.handleInputChange());

    // Initialize @-mention autocomplete
    this.mentionAutocomplete = new MentionAutocomplete(
      this.app,
      this.inputEl,
      inputWrapper,
      (mentions) => {
        this.activeMentions = mentions;
        this.renderMentionTags();
      }
    );

    // Input actions bar
    const inputActions = inputArea.createDiv("vault-claude-input-actions");

    this.tokenCounterEl = inputActions.createDiv("vault-claude-token-counter");

    this.sendBtn = inputActions.createEl("button", {
      cls: "vault-claude-send-btn",
      text: "Send",
    });
    this.sendBtn.addEventListener("click", () => {
      if (this.isGenerating) {
        this.plugin.agentService.abort();
        this.finishGeneration();
      } else {
        this.handleSend();
      }
    });
  }

  async onClose() {
    this.plugin.agentService.abort();
    this.mentionAutocomplete?.destroy();
  }

  /** Public: clear the chat display */
  clearChat() {
    this.messages = [];
    this.currentAssistantEl = null;
    this.currentAssistantContent = "";
    this.pendingEdits = [];
    this.currentConversationId = null;
    this.activeMentions = [];
    this.mentionAutocomplete?.clearMentions();
    this.messagesContainer.empty();
    this.tokenCounterEl.setText("");
    this.renderMentionTags();
    this.showWelcome();
  }

  /** Public: insert text into the input */
  insertText(text: string) {
    this.inputEl.value = text;
  }

  /** Public: focus the input */
  focusInput() {
    this.inputEl.focus();
  }

  /** Public: save the current conversation */
  async saveConversation() {
    if (this.messages.length === 0) {
      new Notice("No conversation to save");
      return;
    }

    const store = this.plugin.conversationStore;
    const id = this.currentConversationId || ConversationStore.generateId();
    this.currentConversationId = id;

    const conversation: SavedConversation = {
      id,
      title: ConversationStore.generateTitle(this.messages),
      createdAt: this.messages[0]?.timestamp || Date.now(),
      updatedAt: Date.now(),
      messageCount: this.messages.length,
      model: this.plugin.settings.model,
      messages: this.messages,
    };

    await store.save(conversation);
    new Notice("Conversation saved");
  }

  /** Public: show the conversation history list */
  async showConversationList() {
    const store = this.plugin.conversationStore;
    const conversations = await store.list();

    if (conversations.length === 0) {
      new Notice("No saved conversations");
      return;
    }

    // Show as an overlay in the messages area
    const overlay = this.messagesContainer.createDiv("vault-claude-history-overlay");

    const header = overlay.createDiv("vault-claude-history-header");
    header.createEl("h4", { text: "Saved Conversations" });
    const closeBtn = header.createEl("button", { cls: "vault-claude-icon-btn" });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => overlay.remove());

    const list = overlay.createDiv("vault-claude-history-list");

    for (const conv of conversations) {
      const item = list.createDiv("vault-claude-history-item");

      const info = item.createDiv("vault-claude-history-info");
      info.createDiv({ text: conv.title, cls: "vault-claude-history-title" });
      const meta = info.createDiv({ cls: "vault-claude-history-meta" });
      meta.setText(
        `${conv.messageCount} messages · ${conv.model} · ${new Date(conv.updatedAt).toLocaleDateString()}`
      );

      const actions = item.createDiv("vault-claude-history-actions");

      const loadBtn = actions.createEl("button", { text: "Load", cls: "vault-claude-history-load" });
      loadBtn.addEventListener("click", async () => {
        await this.loadConversation(conv.id);
        overlay.remove();
      });

      const deleteBtn = actions.createEl("button", { cls: "vault-claude-icon-btn vault-claude-history-delete" });
      setIcon(deleteBtn, "trash");
      deleteBtn.addEventListener("click", async () => {
        await store.delete(conv.id);
        item.remove();
        new Notice("Conversation deleted");
        if (list.children.length === 0) overlay.remove();
      });
    }
  }

  // --- Private ---

  private showWelcome() {
    const welcome = this.messagesContainer.createDiv("vault-claude-welcome");
    welcome.createEl("h3", { text: "Welcome to Vault Claude" });
    welcome.createEl("p", {
      text: "Ask me anything about your vault. I can read, search, create, and edit your notes.",
    });

    // Slash command hints
    const cmdSection = welcome.createDiv("vault-claude-welcome-commands");
    cmdSection.createEl("p", { text: "Quick commands:", cls: "vault-claude-welcome-label" });
    const cmdGrid = cmdSection.createDiv("vault-claude-command-grid");
    for (const cmd of SLASH_COMMANDS.slice(0, 6)) {
      const btn = cmdGrid.createEl("button", { cls: "vault-claude-suggestion" });
      btn.createSpan({ text: cmd.name, cls: "vault-claude-cmd-name" });
      btn.createSpan({ text: ` ${cmd.description}`, cls: "vault-claude-cmd-desc" });
      btn.addEventListener("click", () => {
        this.inputEl.value = cmd.name + " ";
        this.inputEl.focus();
        this.handleInputChange();
      });
    }

    // Example prompts
    const suggestions = welcome.createDiv("vault-claude-suggestions");
    const examplePrompts = [
      "Summarize my recent daily notes",
      "What tags do I use most?",
      "Find all notes about baptism",
    ];
    for (const prompt of examplePrompts) {
      const btn = suggestions.createEl("button", { cls: "vault-claude-suggestion", text: prompt });
      btn.addEventListener("click", () => {
        this.inputEl.value = prompt;
        this.inputEl.focus();
      });
    }
  }

  /** Handle input changes for slash command hints */
  private handleInputChange() {
    const text = this.inputEl.value;

    if (text.startsWith("/")) {
      const matching = SLASH_COMMANDS.filter((cmd) =>
        cmd.name.startsWith(text.split(" ")[0])
      );
      if (matching.length > 0 && !text.includes(" ")) {
        this.slashHintEl.style.display = "block";
        this.slashHintEl.empty();
        for (const cmd of matching.slice(0, 5)) {
          const hint = this.slashHintEl.createDiv("vault-claude-slash-item");
          hint.createSpan({ text: cmd.name, cls: "vault-claude-cmd-name" });
          hint.createSpan({ text: ` — ${cmd.description}`, cls: "vault-claude-cmd-desc" });
          hint.addEventListener("mousedown", (e) => {
            e.preventDefault();
            this.inputEl.value = cmd.name + " ";
            this.inputEl.focus();
            this.slashHintEl.style.display = "none";
          });
        }
      } else {
        this.slashHintEl.style.display = "none";
      }
    } else {
      this.slashHintEl.style.display = "none";
    }
  }

  /** Render active mention tags above the input */
  private renderMentionTags() {
    this.mentionTagsEl.empty();
    if (this.activeMentions.length === 0) {
      this.mentionTagsEl.style.display = "none";
      return;
    }
    this.mentionTagsEl.style.display = "flex";

    for (const mention of this.activeMentions) {
      const tag = this.mentionTagsEl.createDiv("vault-claude-mention-tag");
      const icon = mention.type === "note" ? "file-text" : mention.type === "folder" ? "folder" : "hash";
      const iconEl = tag.createSpan("vault-claude-mention-tag-icon");
      setIcon(iconEl, icon);
      tag.createSpan({ text: mention.display });

      const removeBtn = tag.createSpan("vault-claude-mention-tag-remove");
      setIcon(removeBtn, "x");
      removeBtn.addEventListener("click", () => {
        this.activeMentions = this.activeMentions.filter((m) => m !== mention);
        this.renderMentionTags();
      });
    }
  }

  /** Handle sending a message */
  private async handleSend() {
    const text = this.inputEl.value.trim();
    if (!text || this.isGenerating) return;

    if (!this.plugin.agentService.isReady()) {
      this.addSystemMessage(
        "API key not configured. Go to Settings > Vault Claude to add your key."
      );
      return;
    }

    // Clear welcome on first message
    if (this.messages.length === 0) {
      this.messagesContainer.empty();
    }

    // Add user message to UI
    this.addMessageToUI({ role: "user", content: text, timestamp: Date.now() });
    this.inputEl.value = "";
    this.slashHintEl.style.display = "none";

    // Build the actual prompt
    let prompt = text;
    const activeFile = this.app.workspace.getActiveFile();

    // Check for slash commands
    const slashParsed = parseSlashCommand(text);
    if (slashParsed) {
      prompt = buildSlashCommandPrompt(
        slashParsed.command,
        slashParsed.userText,
        activeFile?.path
      );
    }

    // Add @-mention context
    if (this.mentionAutocomplete && this.activeMentions.length > 0) {
      const mentionContext = await this.mentionAutocomplete.buildMentionContext();
      if (mentionContext.contextParts.length > 0) {
        const contextStr = mentionContext.contextParts
          .map((p) => `[Context from ${p.label}]\n${p.content}`)
          .join("\n\n");
        prompt = `${contextStr}\n\n${prompt}`;
      }
      this.mentionAutocomplete.clearMentions();
      this.activeMentions = [];
      this.renderMentionTags();
    }

    // Get active note context if enabled and no slash command handles it
    let contextNote: { path: string; content: string } | undefined;
    if (this.plugin.settings.autoIncludeActiveNote && !slashParsed) {
      if (activeFile) {
        const content = await this.app.vault.read(activeFile);
        contextNote = { path: activeFile.path, content };
      }
    }

    // Plan mode: inject plan instruction
    if (this.plugin.settings.permissionMode === "plan-only") {
      prompt =
        `[MODE: Plan Only] Before making any changes, present a numbered plan of what you intend to do. ` +
        `Do NOT execute any write or edit operations. Only use read and search tools to gather information. ` +
        `Present your plan and wait for the user to approve before proceeding.\n\n${prompt}`;
    }

    // Start generation
    this.isGenerating = true;
    this.sendBtn.setText("Stop");
    this.sendBtn.addClass("vault-claude-stop-btn");
    this.currentAssistantContent = "";
    this.currentAssistantEl = this.createAssistantMessageEl();

    await this.plugin.agentService.sendMessage(
      prompt,
      {
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

          // Track costs
          if (message.tokenCount) {
            this.plugin.costTracker.addUsage(
              message.tokenCount.input,
              message.tokenCount.output
            );
            this.updateTokenCounter();
          }

          // Check for file edits in approve-edits mode
          if (
            this.plugin.settings.permissionMode === "approve-edits" &&
            message.toolCalls
          ) {
            this.checkForPendingEdits(message.toolCalls);
          }

          this.finishGeneration();
        },
        onError: (error) => {
          this.addSystemMessage(`Error: ${error.message}`);
          this.finishGeneration();
        },
      },
      contextNote
    );
  }

  private finishGeneration() {
    this.isGenerating = false;
    this.sendBtn.setText("Send");
    this.sendBtn.removeClass("vault-claude-stop-btn");
    this.currentAssistantEl = null;
  }

  /** Check tool calls for file edits and show diff cards in approve mode */
  private checkForPendingEdits(toolCalls: ToolCallInfo[]) {
    for (const tc of toolCalls) {
      if (tc.name === "edit_note" && tc.status === "complete" && tc.input) {
        const edit: PendingEdit = {
          id: tc.id,
          filePath: tc.input.path as string,
          oldContent: tc.input.old_string as string,
          newContent: tc.input.new_string as string,
          description: `Edit in ${tc.input.path}`,
          status: "accepted", // Already applied by the tool — show as accepted
        };
        this.pendingEdits.push(edit);
        renderDiffCard(
          this.messagesContainer,
          edit,
          () => {},
          () => {}
        );
        this.scrollToBottom();
      }
    }
  }

  /** Load a saved conversation */
  private async loadConversation(id: string) {
    const store = this.plugin.conversationStore;
    const conversation = await store.load(id);
    if (!conversation) {
      new Notice("Could not load conversation");
      return;
    }

    // Reset state
    this.plugin.agentService.clearHistory();
    this.plugin.costTracker.resetConversation();
    this.messages = [];
    this.messagesContainer.empty();
    this.currentConversationId = conversation.id;

    // Replay messages into UI
    for (const msg of conversation.messages) {
      this.addMessageToUI(msg);
    }

    new Notice(`Loaded: ${conversation.title}`);
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
      MarkdownRenderer.render(this.app, message.content, contentEl, "", this);
    } else {
      contentEl.setText(message.content);
    }

    this.scrollToBottom();
  }

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

  private renderAssistantMessage() {
    if (!this.currentAssistantEl) return;
    const contentEl = this.currentAssistantEl.querySelector(
      ".vault-claude-message-content"
    ) as HTMLElement;
    if (!contentEl) return;

    contentEl.empty();
    MarkdownRenderer.render(this.app, this.currentAssistantContent, contentEl, "", this);
    this.scrollToBottom();
  }

  private addToolCallCard(toolCall: ToolCallInfo) {
    const card = this.messagesContainer.createDiv("vault-claude-tool-card");
    card.id = `tool-${toolCall.id}`;

    const header = card.createDiv("vault-claude-tool-header");
    const icon = header.createSpan("vault-claude-tool-icon");
    setIcon(icon, "wrench");
    header.createSpan({ text: ` ${toolCall.name}`, cls: "vault-claude-tool-name" });
    const statusEl = header.createSpan({ cls: "vault-claude-tool-status" });
    statusEl.setText("running...");

    const inputStr = JSON.stringify(toolCall.input, null, 2);
    if (inputStr.length < 200) {
      card.createDiv({ cls: "vault-claude-tool-input", text: inputStr });
    }

    this.scrollToBottom();
  }

  private updateToolCallCard(toolCallId: string, result: string) {
    const card = this.messagesContainer.querySelector(`#tool-${toolCallId}`) as HTMLElement;
    if (!card) return;

    const statusEl = card.querySelector(".vault-claude-tool-status") as HTMLElement;
    if (statusEl) statusEl.setText("done");

    const resultEl = card.createDiv("vault-claude-tool-result");
    const truncated = result.length > 500 ? result.substring(0, 500) + "..." : result;
    resultEl.setText(truncated);
  }

  private addSystemMessage(text: string) {
    const msgEl = this.messagesContainer.createDiv(
      "vault-claude-message vault-claude-system"
    );
    msgEl.setText(text);
    this.scrollToBottom();
  }

  private updateTokenCounter() {
    if (!this.plugin.settings.showTokenCount) return;
    const summary = this.plugin.costTracker.getConversationSummary(this.plugin.settings.model);
    this.tokenCounterEl.setText(summary);
    this.tokenCounterEl.setAttribute(
      "title",
      this.plugin.costTracker.getDetailedSummary(this.plugin.settings.model)
    );
  }

  private scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}
