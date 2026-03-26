import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type VaultClaudePlugin from "../main";
import type { ChatMessage, ToolCallInfo } from "../agent/agent-service";
import { parseSlashCommand, buildSlashCommandPrompt, SLASH_COMMANDS } from "../commands/slash-commands";
import { MentionAutocomplete, type MentionItem } from "./mention-autocomplete";
import { renderDiffCard, type PendingEdit } from "./diff-view";
import { ConversationStore, type SavedConversation } from "../storage/conversation-store";

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
  private renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private renderPending = false;
  private selectedMessages: Set<number> = new Set(); // indices into this.messages
  private selectionBarEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: VaultClaudePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return "Obsidian Claude";
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen() {
    await super.onOpen();
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("vault-claude-container");

    // Header
    const header = container.createDiv("vault-claude-header");
    header.createEl("h4", { text: "Obsidian Claude" });

    const headerActions = header.createDiv("vault-claude-header-actions");

    const historyBtn = headerActions.createEl("button", {
      cls: "vault-claude-icon-btn",
      attr: { "aria-label": "Conversation history" },
    });
    setIcon(historyBtn, "clock");
    historyBtn.addEventListener("click", () => void this.showConversationList());

    const saveBtn = headerActions.createEl("button", {
      cls: "vault-claude-icon-btn",
      attr: { "aria-label": "Save conversation" },
    });
    setIcon(saveBtn, "save");
    saveBtn.addEventListener("click", () => void this.saveConversation());

    const exportBtn = headerActions.createEl("button", {
      cls: "vault-claude-icon-btn",
      attr: { "aria-label": "Export conversation as note" },
    });
    setIcon(exportBtn, "file-output");
    exportBtn.addEventListener("click", () => void this.exportConversationAsNote());

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

    // Floating selection action bar (hidden by default via CSS)
    this.selectionBarEl = container.createDiv("vault-claude-selection-bar");
    this.selectionBarEl.addClass("vault-claude-hidden");

    const selCountEl = this.selectionBarEl.createSpan("vault-claude-sel-count");
    selCountEl.setText("0 selected");

    const selSummarizeBtn = this.selectionBarEl.createEl("button", {
      text: "Summarize to document",
      cls: "vault-claude-sel-action",
    });
    setIcon(selSummarizeBtn.createSpan({ cls: "vault-claude-sel-icon" }), "file-plus");
    selSummarizeBtn.addEventListener("click", () => void this.summarizeSelectedToDocument());

    const selClearBtn = this.selectionBarEl.createEl("button", {
      text: "Clear",
      cls: "vault-claude-sel-clear",
    });
    selClearBtn.addEventListener("click", () => this.clearSelection());

    // Input area
    const inputArea = container.createDiv("vault-claude-input-area");

    // Mention tags display
    this.mentionTagsEl = inputArea.createDiv("vault-claude-mention-tags");

    // Slash command hint
    this.slashHintEl = inputArea.createDiv("vault-claude-slash-hint");
    this.slashHintEl.addClass("vault-claude-hidden");

    // Input wrapper (for positioning autocomplete dropdown)
    const inputWrapper = inputArea.createDiv("vault-claude-input-wrapper");

    this.inputEl = inputWrapper.createEl("textarea", {
      cls: "vault-claude-input",
      attr: { placeholder: "Ask about your vault... (/ for commands, @ to mention)", rows: "3" },
    });

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
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
        void this.handleSend();
      }
    });
  }

  async onClose() {
    if (this.renderDebounceTimer) {
      clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = null;
    }
    this.plugin.agentService.abort();
    this.mentionAutocomplete?.destroy();
    await super.onClose();
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
    this.selectedMessages.clear();
    this.updateSelectionBar();
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
    header.createEl("h4", { text: "Saved conversations" });
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
      loadBtn.addEventListener("click", () => {
        void this.loadConversation(conv.id).then(() => overlay.remove());
      });

      const deleteBtn = actions.createEl("button", { cls: "vault-claude-icon-btn vault-claude-history-delete" });
      setIcon(deleteBtn, "trash");
      deleteBtn.addEventListener("click", () => {
        void store.delete(conv.id).then(() => {
          item.remove();
          new Notice("Conversation deleted");
          if (list.children.length === 0) overlay.remove();
        });
      });
    }
  }

  // --- Private ---

  private showWelcome() {
    const welcome = this.messagesContainer.createDiv("vault-claude-welcome");
    welcome.createEl("h3", { text: "Obsidian Claude" });
    welcome.createEl("p", {
      text: "Your AI writing partner. Ask anything, or pick a quick action below.",
    });

    // Curated featured commands — 6 most useful, one from each category
    const featured = ["/brainstorm", "/wordsmith", "/summarize", "/critique", "/find-hyperlinks", "/ask"];
    const featuredCmds = featured
      .map((name) => SLASH_COMMANDS.find((c) => c.name === name))
      .filter(Boolean) as typeof SLASH_COMMANDS;

    const cmdSection = welcome.createDiv("vault-claude-welcome-commands");
    const cmdGrid = cmdSection.createDiv("vault-claude-featured-grid");

    for (const cmd of featuredCmds) {
      const btn = cmdGrid.createEl("button", { cls: "vault-claude-featured-btn" });
      btn.createSpan({ text: cmd.name, cls: "vault-claude-cmd-name" });
      btn.createEl("br");
      btn.createSpan({ text: cmd.description, cls: "vault-claude-cmd-desc" });
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

    // Hint for full command list
    const hint = welcome.createDiv("vault-claude-welcome-hint");
    hint.setText(`Type / for all ${SLASH_COMMANDS.length} commands, or @ to mention a note`);
  }

  /** Handle input changes for slash command hints */
  private handleInputChange() {
    const text = this.inputEl.value;

    if (text.startsWith("/")) {
      const matching = SLASH_COMMANDS.filter((cmd) =>
        cmd.name.startsWith(text.split(" ")[0])
      );
      if (matching.length > 0 && !text.includes(" ")) {
        this.slashHintEl.removeClass("vault-claude-hidden");
        this.slashHintEl.empty();
        for (const cmd of matching.slice(0, 5)) {
          const hint = this.slashHintEl.createDiv("vault-claude-slash-item");
          hint.createSpan({ text: cmd.name, cls: "vault-claude-cmd-name" });
          hint.createSpan({ text: ` — ${cmd.description}`, cls: "vault-claude-cmd-desc" });
          hint.addEventListener("mousedown", (e) => {
            e.preventDefault();
            this.inputEl.value = cmd.name + " ";
            this.inputEl.focus();
            this.slashHintEl.addClass("vault-claude-hidden");
          });
        }
      } else {
        this.slashHintEl.addClass("vault-claude-hidden");
      }
    } else {
      this.slashHintEl.addClass("vault-claude-hidden");
    }
  }

  /** Render active mention tags above the input */
  private renderMentionTags() {
    this.mentionTagsEl.empty();
    if (this.activeMentions.length === 0) {
      this.mentionTagsEl.addClass("vault-claude-hidden");
      return;
    }
    this.mentionTagsEl.removeClass("vault-claude-hidden");

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
        "API key not configured. Go to Settings > Obsidian Claude to add your key."
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
    this.slashHintEl.addClass("vault-claude-hidden");

    // Build the actual prompt
    let prompt = text;
    const activeFile = this.app.workspace.getActiveFile();

    // Check for slash commands
    let useLightModel = false;
    const slashParsed = parseSlashCommand(text);
    if (slashParsed) {
      prompt = buildSlashCommandPrompt(
        slashParsed.command,
        slashParsed.userText,
        activeFile?.path
      );
      useLightModel = !!slashParsed.command.useLightModel;
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
      contextNote,
      useLightModel
    );
  }

  private finishGeneration() {
    this.isGenerating = false;
    this.sendBtn.setText("Send");
    this.sendBtn.removeClass("vault-claude-stop-btn");

    // Flush any pending render so final content is always shown
    if (this.renderDebounceTimer) {
      clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = null;
    }
    if (this.renderPending && this.currentAssistantEl) {
      this.renderPending = false;
      const contentEl = this.currentAssistantEl.querySelector(
        ".vault-claude-message-content"
      ) as HTMLElement;
      if (contentEl) {
        contentEl.empty();
        MarkdownRenderer.render(this.app, this.currentAssistantContent, contentEl, "", this);
        this.scrollToBottom();
      }
    }

    // Wire up actions on the completed streaming message
    if (this.currentAssistantEl) {
      const msgIndex = this.messages.length - 1;
      this.currentAssistantEl.dataset.msgIndex = String(msgIndex);
      const content = this.currentAssistantContent;

      // Enable checkbox
      const checkbox = this.currentAssistantEl.querySelector(
        ".vault-claude-msg-checkbox"
      ) as HTMLInputElement;
      if (checkbox) {
        checkbox.disabled = false;
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            this.selectedMessages.add(msgIndex);
          } else {
            this.selectedMessages.delete(msgIndex);
          }
          this.updateSelectionBar();
        });
      }

      // Add action buttons
      const actions = this.currentAssistantEl.querySelector(
        ".vault-claude-msg-actions"
      ) as HTMLElement;
      if (actions) {
        const copyBtn = actions.createEl("button", {
          cls: "vault-claude-msg-action-btn",
          attr: { "aria-label": "Copy to clipboard" },
        });
        setIcon(copyBtn, "copy");
        copyBtn.addEventListener("click", () => {
          void navigator.clipboard.writeText(content);
          new Notice("Copied to clipboard");
        });

        const insertBtn = actions.createEl("button", {
          cls: "vault-claude-msg-action-btn",
          attr: { "aria-label": "Insert into active note" },
        });
        setIcon(insertBtn, "file-input");
        insertBtn.addEventListener("click", () => void this.insertIntoDocument(content));
      }
    }

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
          description: `Edit in ${String(tc.input.path)}`,
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
    const msgIndex = this.messages.length - 1;
    const msgEl = this.messagesContainer.createDiv(
      `vault-claude-message vault-claude-${message.role}`
    );
    msgEl.dataset.msgIndex = String(msgIndex);

    // Top row: label + actions
    const topRow = msgEl.createDiv("vault-claude-message-top");

    // Checkbox for selection
    const checkbox = topRow.createEl("input", {
      cls: "vault-claude-msg-checkbox",
      attr: { type: "checkbox" },
    }) as HTMLInputElement;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        this.selectedMessages.add(msgIndex);
      } else {
        this.selectedMessages.delete(msgIndex);
      }
      this.updateSelectionBar();
    });

    const label = topRow.createDiv("vault-claude-message-label");
    label.setText(message.role === "user" ? "You" : "Claude");

    // Action buttons for assistant messages
    if (message.role === "assistant") {
      const actions = topRow.createDiv("vault-claude-msg-actions");

      // Copy button
      const copyBtn = actions.createEl("button", {
        cls: "vault-claude-msg-action-btn",
        attr: { "aria-label": "Copy to clipboard" },
      });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", () => {
        void navigator.clipboard.writeText(message.content);
        new Notice("Copied to clipboard");
      });

      // Insert to document button
      const insertBtn = actions.createEl("button", {
        cls: "vault-claude-msg-action-btn",
        attr: { "aria-label": "Insert into active note" },
      });
      setIcon(insertBtn, "file-input");
      insertBtn.addEventListener("click", () => void this.insertIntoDocument(message.content));
    }

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

    const topRow = msgEl.createDiv("vault-claude-message-top");

    // Checkbox (will be wired up in onComplete when message is finalized)
    topRow.createEl("input", {
      cls: "vault-claude-msg-checkbox",
      attr: { type: "checkbox", disabled: "true" },
    });

    const label = topRow.createDiv("vault-claude-message-label");
    label.setText("Claude");

    // Actions placeholder — populated after streaming completes
    topRow.createDiv("vault-claude-msg-actions");

    msgEl.createDiv("vault-claude-message-content");
    this.scrollToBottom();
    return msgEl;
  }

  /** Debounced markdown render — avoids re-rendering on every single token */
  private renderAssistantMessage() {
    if (!this.currentAssistantEl) return;
    this.renderPending = true;

    if (this.renderDebounceTimer) return; // already scheduled

    this.renderDebounceTimer = setTimeout(() => {
      this.renderDebounceTimer = null;
      if (!this.renderPending || !this.currentAssistantEl) return;
      this.renderPending = false;

      const contentEl = this.currentAssistantEl.querySelector(
        ".vault-claude-message-content"
      ) as HTMLElement;
      if (!contentEl) return;

      contentEl.empty();
      MarkdownRenderer.render(this.app, this.currentAssistantContent, contentEl, "", this);
      this.scrollToBottom();
    }, 80); // ~12fps — smooth enough, way cheaper than per-token
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
    const isOllama = this.plugin.settings.authProvider === "ollama";
    const model = this.plugin.settings.model;
    const summary = this.plugin.costTracker.getConversationSummary(model, isOllama);
    this.tokenCounterEl.setText(summary);
    this.tokenCounterEl.setAttribute(
      "title",
      this.plugin.costTracker.getDetailedSummary(model, isOllama)
    );
  }

  /** Insert content at cursor position in the active note */
  private async insertIntoDocument(content: string) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No note is open. Open a note first.");
      return;
    }

    const editor = this.app.workspace.activeEditor?.editor;
    if (editor) {
      // Insert at cursor
      const cursor = editor.getCursor();
      editor.replaceRange(content + "\n", cursor);
      new Notice(`Inserted into ${activeFile.basename}`);
    } else {
      // Fallback: append to file
      const existing = await this.app.vault.read(activeFile);
      await this.app.vault.modify(activeFile, existing + "\n\n" + content);
      new Notice(`Appended to ${activeFile.basename}`);
    }
  }

  /** Update the floating selection bar visibility and count */
  private updateSelectionBar() {
    if (!this.selectionBarEl) return;
    const count = this.selectedMessages.size;
    if (count === 0) {
      this.selectionBarEl.addClass("vault-claude-hidden");
      return;
    }
    this.selectionBarEl.removeClass("vault-claude-hidden");
    const countEl = this.selectionBarEl.querySelector(".vault-claude-sel-count");
    if (countEl) countEl.setText(`${count} selected`);
  }

  /** Clear all selected messages */
  private clearSelection() {
    this.selectedMessages.clear();
    // Uncheck all checkboxes
    this.messagesContainer.querySelectorAll(".vault-claude-msg-checkbox").forEach((el) => {
      (el as HTMLInputElement).checked = false;
    });
    this.updateSelectionBar();
  }

  /** Summarize selected messages via AI and insert into active document */
  private async summarizeSelectedToDocument() {
    if (this.selectedMessages.size === 0) return;
    if (this.isGenerating) {
      new Notice("Wait for the current response to finish.");
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No note is open. Open a note to insert the summary.");
      return;
    }

    // Gather selected message contents
    const selectedContents = Array.from(this.selectedMessages)
      .sort((a, b) => a - b)
      .map((idx) => {
        const msg = this.messages[idx];
        return `[${msg.role === "user" ? "User" : "Assistant"}]:\n${msg.content}`;
      })
      .join("\n\n---\n\n");

    // Build a summarization prompt
    const prompt =
      `The user has selected the following messages from a conversation. ` +
      `Create a rich, well-structured summary that synthesizes the key insights, findings, and content. ` +
      `Use markdown formatting (headings, bullet points, bold for key terms). ` +
      `Write it as a standalone document section — not as a conversation recap.\n\n` +
      `---\n${selectedContents}\n---`;

    // Clear selection visually
    this.clearSelection();

    // Show "Summarizing..." in chat
    this.isGenerating = true;
    this.sendBtn.setText("Stop");
    this.sendBtn.addClass("vault-claude-stop-btn");
    this.currentAssistantContent = "";
    this.currentAssistantEl = this.createAssistantMessageEl();

    // Add a system note so user knows what's happening
    this.addSystemMessage(`Summarizing ${this.selectedMessages.size > 0 ? "" : "selected messages"} → ${activeFile.basename}...`);

    await this.plugin.agentService.sendMessage(
      prompt,
      {
        onToken: (token) => {
          this.currentAssistantContent += token;
          this.renderAssistantMessage();
        },
        onToolCall: () => {},
        onToolResult: () => {},
        onComplete: (message) => {
          this.messages.push(message);
          if (message.tokenCount) {
            this.plugin.costTracker.addUsage(message.tokenCount.input, message.tokenCount.output);
            this.updateTokenCounter();
          }
          this.finishGeneration();

          // Insert the summary into the document
          void this.insertIntoDocument(message.content);
        },
        onError: (error) => {
          this.addSystemMessage(`Error: ${error.message}`);
          this.finishGeneration();
        },
      },
      undefined,
      false // use primary model for synthesis
    );
  }

  /** Export the full conversation as a markdown note in the vault */
  async exportConversationAsNote() {
    if (this.messages.length === 0) {
      new Notice("No conversation to export");
      return;
    }

    // Build markdown content
    const title = ConversationStore.generateTitle(this.messages);
    const date = new Date().toISOString().split("T")[0];
    const lines: string[] = [
      "---",
      `title: "${title}"`,
      `creation_date: "${date}"`,
      `tags:`,
      `  - ai-conversation`,
      "---",
      "",
      `# ${title}`,
      "",
    ];

    for (const msg of this.messages) {
      if (msg.role === "user") {
        lines.push(`## You`, "", msg.content, "");
      } else {
        lines.push(`## Claude`, "", msg.content, "");
      }
    }

    // Determine save path — use the active file's folder, or vault root
    const activeFile = this.app.workspace.getActiveFile();
    const folder = activeFile ? activeFile.parent?.path || "" : "";
    const safeName = title.replace(/[\\/:*?"<>|]/g, "-").substring(0, 80);
    const path = folder ? `${folder}/${safeName}.md` : `${safeName}.md`;

    // Check for existing
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, lines.join("\n"));
    } else if (!existing) {
      await this.app.vault.create(path, lines.join("\n"));
    }

    new Notice(`Conversation saved to ${path}`);

    // Open the new note
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      await this.app.workspace.openLinkText(path, "", false);
    }
  }

  private scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}
