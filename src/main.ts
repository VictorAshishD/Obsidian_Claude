import { Plugin, WorkspaceLeaf } from "obsidian";
import { VaultClaudeSettingTab, DEFAULT_SETTINGS, type VaultClaudeSettings } from "./settings";
import { AgentService } from "./agent/agent-service";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/chat-view";
import { SLASH_COMMANDS } from "./commands/slash-commands";
import { ConversationStore } from "./storage/conversation-store";
import { CostTracker } from "./ui/cost-tracker";

export default class VaultClaudePlugin extends Plugin {
  settings: VaultClaudeSettings = DEFAULT_SETTINGS;
  agentService!: AgentService;
  conversationStore!: ConversationStore;
  costTracker!: CostTracker;

  async onload() {
    await this.loadSettings();

    // Initialize services
    this.agentService = new AgentService(this.app, this.settings);
    this.agentService.initialize();
    this.conversationStore = new ConversationStore(this.app);
    this.costTracker = new CostTracker();

    // Register the chat sidebar view
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

    // Add ribbon icon to toggle chat
    this.addRibbonIcon("message-circle", "Open Obsidian Claude", () => {
      this.activateChatView();
    });

    // --- Core commands ---
    this.addCommand({
      id: "open-chat",
      name: "Open chat panel",
      callback: () => this.activateChatView(),
    });

    this.addCommand({
      id: "new-conversation",
      name: "Start new conversation",
      callback: () => {
        this.costTracker.resetConversation();
        this.agentService.clearHistory();
        const view = this.getChatView();
        if (view) view.clearChat();
      },
    });

    this.addCommand({
      id: "stop-generation",
      name: "Stop current generation",
      callback: () => this.agentService.abort(),
    });

    this.addCommand({
      id: "save-conversation",
      name: "Save current conversation",
      callback: () => {
        const view = this.getChatView();
        if (view) void view.saveConversation();
      },
    });

    this.addCommand({
      id: "load-conversation",
      name: "Load a saved conversation",
      callback: () => {
        const view = this.getChatView();
        if (view) view.showConversationList();
      },
    });

    // --- Slash commands registered as Obsidian commands ---
    for (const cmd of SLASH_COMMANDS) {
      this.addCommand({
        id: `slash-${cmd.name.slice(1)}`,
        name: `${cmd.name} — ${cmd.description}`,
        callback: async () => {
          await this.activateChatView();
          const view = this.getChatView();
          if (view) {
            view.insertText(cmd.name + " ");
            view.focusInput();
          }
        },
      });
    }

    // Settings tab
    this.addSettingTab(new VaultClaudeSettingTab(this.app, this));
  }

  onunload() {
    this.agentService.abort();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.agentService.initialize();
  }

  /** Open or focus the chat sidebar */
  async activateChatView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /** Get the active chat view instance */
  getChatView(): ChatView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    if (leaves.length > 0) {
      const view = leaves[0].view;
      if (view instanceof ChatView) return view;
    }
    return null;
  }
}
