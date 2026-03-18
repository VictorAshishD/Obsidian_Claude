import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultClaudePlugin from "./main";

export type ModelId =
  | "claude-haiku-4-5-20251001"
  | "claude-sonnet-4-6"
  | "claude-opus-4-6";

export type PermissionMode = "auto" | "approve-edits" | "plan-only";

export type AuthProvider = "anthropic" | "bedrock" | "vertex" | "azure";

export interface VaultClaudeSettings {
  apiKey: string;
  model: ModelId;
  permissionMode: PermissionMode;
  authProvider: AuthProvider;
  maxTokens: number;
  systemPrompt: string;
  autoIncludeActiveNote: boolean;
  showToolCalls: boolean;
  showTokenCount: boolean;
  conversationHistoryLimit: number;
}

export const DEFAULT_SETTINGS: VaultClaudeSettings = {
  apiKey: "",
  model: "claude-sonnet-4-6",
  permissionMode: "approve-edits",
  authProvider: "anthropic",
  maxTokens: 8192,
  systemPrompt: "",
  autoIncludeActiveNote: true,
  showToolCalls: true,
  showTokenCount: true,
  conversationHistoryLimit: 50,
};

export class VaultClaudeSettingTab extends PluginSettingTab {
  plugin: VaultClaudePlugin;

  constructor(app: App, plugin: VaultClaudePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Authentication ---
    containerEl.createEl("h2", { text: "Authentication" });

    new Setting(containerEl)
      .setName("API provider")
      .setDesc("Choose your Claude API provider")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("anthropic", "Anthropic (Direct)")
          .addOption("bedrock", "AWS Bedrock")
          .addOption("vertex", "Google Vertex AI")
          .addOption("azure", "Microsoft Azure")
          .setValue(this.plugin.settings.authProvider)
          .onChange(async (value: string) => {
            this.plugin.settings.authProvider = value as AuthProvider;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Your Anthropic API key (stored locally in plugin data)")
      .addText((text) =>
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.apiKey)
          .then((t) => {
            t.inputEl.type = "password";
            t.inputEl.style.width = "300px";
          })
          .onChange(async (value: string) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Model ---
    containerEl.createEl("h2", { text: "Model" });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Which Claude model to use")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("claude-haiku-4-5-20251001", "Haiku 4.5 (fastest, cheapest)")
          .addOption("claude-sonnet-4-6", "Sonnet 4.6 (balanced)")
          .addOption("claude-opus-4-6", "Opus 4.6 (most capable)")
          .setValue(this.plugin.settings.model)
          .onChange(async (value: string) => {
            this.plugin.settings.model = value as ModelId;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max tokens")
      .setDesc("Maximum tokens in Claude's response")
      .addText((text) =>
        text
          .setPlaceholder("8192")
          .setValue(String(this.plugin.settings.maxTokens))
          .onChange(async (value: string) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.maxTokens = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    // --- Permissions ---
    containerEl.createEl("h2", { text: "Permissions" });

    new Setting(containerEl)
      .setName("Permission mode")
      .setDesc(
        "How Claude handles file modifications"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto (no confirmations)")
          .addOption("approve-edits", "Approve Edits (confirm writes)")
          .addOption("plan-only", "Plan Only (propose, don't execute)")
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (value: string) => {
            this.plugin.settings.permissionMode = value as PermissionMode;
            await this.plugin.saveSettings();
          })
      );

    // --- Behavior ---
    containerEl.createEl("h2", { text: "Behavior" });

    new Setting(containerEl)
      .setName("Auto-include active note")
      .setDesc(
        "Automatically include the currently open note as context with every message"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoIncludeActiveNote)
          .onChange(async (value: boolean) => {
            this.plugin.settings.autoIncludeActiveNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show tool calls")
      .setDesc("Display tool call cards (file reads, searches, etc.) in the chat")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showToolCalls)
          .onChange(async (value: boolean) => {
            this.plugin.settings.showToolCalls = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show token count")
      .setDesc("Display token usage and estimated cost per message")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTokenCount)
          .onChange(async (value: boolean) => {
            this.plugin.settings.showTokenCount = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Custom System Prompt ---
    containerEl.createEl("h2", { text: "Custom System Prompt" });

    new Setting(containerEl)
      .setName("System prompt")
      .setDesc(
        "Additional instructions prepended to every conversation. Leave blank to use defaults."
      )
      .addTextArea((text) =>
        text
          .setPlaceholder(
            "You are an expert assistant for my Obsidian vault..."
          )
          .setValue(this.plugin.settings.systemPrompt)
          .then((t) => {
            t.inputEl.rows = 6;
            t.inputEl.style.width = "100%";
          })
          .onChange(async (value: string) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
