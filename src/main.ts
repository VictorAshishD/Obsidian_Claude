import { Plugin, WorkspaceLeaf } from "obsidian";
import { VaultClaudeSettingTab, DEFAULT_SETTINGS, type VaultClaudeSettings } from "./settings";
import { AgentService } from "./agent/agent-service";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/chat-view";

export default class VaultClaudePlugin extends Plugin {
  settings: VaultClaudeSettings = DEFAULT_SETTINGS;
  agentService!: AgentService;

  async onload() {
    await this.loadSettings();

    // Initialize agent service
    this.agentService = new AgentService(this.app, this.settings);
    this.agentService.initialize();

    // Register the chat sidebar view
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

    // Add ribbon icon to toggle chat
    this.addRibbonIcon("message-circle", "Open Vault Claude", () => {
      this.activateChatView();
    });

    // Register commands
    this.addCommand({
      id: "open-chat",
      name: "Open chat panel",
      callback: () => this.activateChatView(),
    });

    this.addCommand({
      id: "new-conversation",
      name: "Start new conversation",
      callback: () => {
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
    this.agentService.initialize(); // reinitialize client with new settings
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
      return leaves[0].view as ChatView;
    }
    return null;
  }
}
