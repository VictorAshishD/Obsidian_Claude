import { App, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type VaultClaudePlugin from "./main";
import { detectClaudeCLI, type CLIDetectionResult } from "./agent/claude-cli-client";

export type PermissionMode = "auto" | "approve-edits" | "plan-only";

export type AuthProvider = "claude-cli" | "anthropic" | "openrouter" | "bedrock" | "vertex" | "azure";

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
}

export interface VaultClaudeSettings {
  apiKey: string;
  model: string;
  lightModel: string;
  permissionMode: PermissionMode;
  authProvider: AuthProvider;
  maxTokens: number;
  systemPrompt: string;
  autoIncludeActiveNote: boolean;
  showToolCalls: boolean;
  showTokenCount: boolean;
  conversationHistoryLimit: number;
  openRouterModelsCache: OpenRouterModel[];
  openRouterModelsCacheTime: number;
  cliMaxTurns: number;
}

export const DEFAULT_SETTINGS: VaultClaudeSettings = {
  apiKey: "",
  model: "claude-sonnet-4-6",
  lightModel: "claude-haiku-4-5-20251001",
  permissionMode: "approve-edits",
  authProvider: "claude-cli",
  maxTokens: 8192,
  systemPrompt: "",
  autoIncludeActiveNote: true,
  showToolCalls: true,
  showTokenCount: true,
  conversationHistoryLimit: 50,
  openRouterModelsCache: [],
  openRouterModelsCacheTime: 0,
  cliMaxTurns: 10,
};

const ANTHROPIC_MODELS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "Haiku 4.5 (fastest, cheapest)",
  "claude-sonnet-4-6": "Sonnet 4.6 (balanced)",
  "claude-opus-4-6": "Opus 4.6 (most capable)",
};

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const MODEL_CACHE_TTL = 1000 * 60 * 60; // 1 hour

/** Fetch available models from OpenRouter API */
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const response = await requestUrl({
    url: `${OPENROUTER_API_BASE}/models`,
    method: "GET",
  });

  const data = response.json;
  if (!data?.data || !Array.isArray(data.data)) {
    throw new Error("Invalid response from OpenRouter models API");
  }

  return (data.data as OpenRouterModel[])
    .filter((m: OpenRouterModel) => m.id && m.name)
    .sort((a: OpenRouterModel, b: OpenRouterModel) => a.name.localeCompare(b.name));
}

export class VaultClaudeSettingTab extends PluginSettingTab {
  plugin: VaultClaudePlugin;
  private modelDropdownEl: HTMLSelectElement | null = null;
  private lightModelDropdownEl: HTMLSelectElement | null = null;
  private cliStatus: CLIDetectionResult | null = null;

  constructor(app: App, plugin: VaultClaudePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ================================================================
    // CONNECTION MODE
    // ================================================================
    containerEl.createEl("h2", { text: "Connection Mode" });

    const modeDesc = containerEl.createDiv("vault-claude-mode-desc");
    modeDesc.innerHTML =
      '<p style="color: var(--text-muted); font-size: 12px; margin: 0 0 12px;">' +
      "Choose how Obsidian Claude connects to AI. You can use your <strong>existing Claude Code installation</strong> " +
      "(no extra cost if you have a Claude subscription), or connect directly via <strong>API key</strong> " +
      "for more control over model selection and providers.</p>";

    new Setting(containerEl)
      .setName("Connection mode")
      .setDesc("")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("claude-cli", "Claude Code CLI (uses your existing login)")
          .addOption("anthropic", "Anthropic API Key (direct)")
          .addOption("openrouter", "OpenRouter API Key (multi-model)")
          .addOption("bedrock", "AWS Bedrock")
          .addOption("vertex", "Google Vertex AI")
          .addOption("azure", "Microsoft Azure")
          .setValue(this.plugin.settings.authProvider)
          .onChange(async (value: string) => {
            this.plugin.settings.authProvider = value as AuthProvider;
            if (value !== "openrouter" && value !== "claude-cli") {
              this.plugin.settings.model = "claude-sonnet-4-6";
            }
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // Show provider-specific configuration
    const provider = this.plugin.settings.authProvider;

    if (provider === "claude-cli") {
      this.renderCLISettings(containerEl);
    } else if (provider === "openrouter") {
      this.renderAPIKeySettings(containerEl, "openrouter");
      this.renderOpenRouterModelSelector(containerEl);
    } else {
      this.renderAPIKeySettings(containerEl, provider);
      this.renderAnthropicModelSelector(containerEl);
    }

    // ================================================================
    // MAX TOKENS
    // ================================================================
    new Setting(containerEl)
      .setName("Max tokens")
      .setDesc("Maximum tokens in the response")
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

    // ================================================================
    // LIGHT MODEL (Two-Tiered System)
    // ================================================================
    containerEl.createEl("h2", { text: "Two-Tiered Model System" });

    const tierDesc = containerEl.createDiv("vault-claude-mode-desc");
    tierDesc.innerHTML =
      '<p style="color: var(--text-muted); font-size: 12px; margin: 0 0 12px;">' +
      "Some quick tasks (tagging, TOC generation, readability checks, finding links) use a <strong>lighter, " +
      "cheaper model</strong> to save cost and respond faster. Complex tasks use your primary model above.</p>";

    if (provider === "openrouter") {
      const lightSetting = new Setting(containerEl)
        .setName("Light model")
        .setDesc("Used for quick tasks marked with \u26A1. Select from your OpenRouter models.");

      lightSetting.addDropdown((dropdown) => {
        this.lightModelDropdownEl = dropdown.selectEl;
        const cached = this.plugin.settings.openRouterModelsCache;
        if (cached.length > 0) {
          this.populateModelDropdown(dropdown.selectEl, cached);
          dropdown.setValue(this.plugin.settings.lightModel);
        } else {
          dropdown.addOption("", "-- Refresh models above first --");
          dropdown.setDisabled(true);
        }
        dropdown.onChange(async (value: string) => {
          this.plugin.settings.lightModel = value;
          await this.plugin.saveSettings();
        });
      });
    } else {
      new Setting(containerEl)
        .setName("Light model")
        .setDesc("Used for quick tasks marked with \u26A1 (tags, TOC, links, readability)")
        .addDropdown((dropdown) => {
          for (const [id, label] of Object.entries(ANTHROPIC_MODELS)) {
            dropdown.addOption(id, label);
          }
          dropdown
            .setValue(this.plugin.settings.lightModel)
            .onChange(async (value: string) => {
              this.plugin.settings.lightModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // ================================================================
    // PERMISSIONS
    // ================================================================
    containerEl.createEl("h2", { text: "Permissions" });

    new Setting(containerEl)
      .setName("Permission mode")
      .setDesc("How the assistant handles file modifications")
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

    // ================================================================
    // BEHAVIOR
    // ================================================================
    containerEl.createEl("h2", { text: "Behavior" });

    new Setting(containerEl)
      .setName("Auto-include active note")
      .setDesc("Automatically include the currently open note as context with every message")
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

    // ================================================================
    // CUSTOM SYSTEM PROMPT
    // ================================================================
    containerEl.createEl("h2", { text: "Custom System Prompt" });

    new Setting(containerEl)
      .setName("System prompt")
      .setDesc("Additional instructions prepended to every conversation. Leave blank to use defaults.")
      .addTextArea((text) =>
        text
          .setPlaceholder("You are an expert assistant for my Obsidian vault...")
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

    // ================================================================
    // SAVE BUTTON
    // ================================================================
    const saveSection = containerEl.createDiv("vault-claude-save-section");
    saveSection.style.cssText =
      "margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--background-modifier-border); " +
      "display: flex; justify-content: flex-end; gap: 12px; align-items: center;";

    const savedMsg = saveSection.createSpan();
    savedMsg.style.cssText = "color: var(--text-success); font-size: 12px; opacity: 0; transition: opacity 0.3s;";
    savedMsg.setText("\u2713 Settings saved");

    const saveBtn = saveSection.createEl("button", {
      text: "Save Settings",
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", async () => {
      await this.plugin.saveSettings();
      this.plugin.agentService.initialize();
      savedMsg.style.opacity = "1";
      setTimeout(() => {
        savedMsg.style.opacity = "0";
      }, 2000);
      new Notice("Obsidian Claude settings saved");
    });
  }

  // ================================================================
  // CLAUDE CODE CLI SETTINGS
  // ================================================================

  private renderCLISettings(containerEl: HTMLElement): void {
    // Info box
    const infoBox = containerEl.createDiv("vault-claude-info-box");
    infoBox.innerHTML =
      '<div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); ' +
      'border-radius: var(--radius-m); padding: 12px; margin-bottom: 12px; font-size: 12px;">' +
      "<strong>How this works:</strong> Obsidian Claude sends prompts to the Claude Code CLI " +
      "(<code>claude -p</code>) installed on your system. This uses your existing Claude " +
      "subscription — no separate API key or extra cost needed." +
      "<br><br>" +
      "<strong>Requirements:</strong><br>" +
      "1. Claude Code CLI installed (<code>npm install -g @anthropic-ai/claude-code</code>)<br>" +
      "2. Authenticated (<code>claude login</code> in your terminal)<br>" +
      "3. Active Claude subscription (Pro, Team, or Enterprise)" +
      "</div>";

    // Status detection
    const statusSetting = new Setting(containerEl)
      .setName("CLI status")
      .setDesc("Checking...");

    statusSetting.addButton((btn) =>
      btn.setButtonText("Check status").onClick(async () => {
        btn.setButtonText("Checking...");
        btn.setDisabled(true);
        await this.checkCLIStatus(statusSetting);
        btn.setButtonText("Check status");
        btn.setDisabled(false);
      })
    );

    // Auto-check on render
    this.checkCLIStatus(statusSetting);

    // Model selection (CLI supports these natively)
    containerEl.createEl("h2", { text: "Model" });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Which model the CLI should use. Leave empty to use your CLI's default.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Default (CLI setting)");
        for (const [id, label] of Object.entries(ANTHROPIC_MODELS)) {
          dropdown.addOption(id, label);
        }
        dropdown
          .setValue(this.plugin.settings.model)
          .onChange(async (value: string) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          });
      });

    // Max turns
    new Setting(containerEl)
      .setName("Max turns")
      .setDesc(
        "Maximum number of agentic tool-use turns the CLI can take per request. " +
        "Higher values allow more complex multi-step operations."
      )
      .addText((text) =>
        text
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.cliMaxTurns))
          .onChange(async (value: string) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
              this.plugin.settings.cliMaxTurns = parsed;
              await this.plugin.saveSettings();
            }
          })
      );
  }

  private async checkCLIStatus(setting: Setting): Promise<void> {
    try {
      const result = await detectClaudeCLI();
      this.cliStatus = result;

      setting.descEl.empty();

      if (result.found && result.authenticated) {
        setting.descEl.innerHTML =
          `<span style="color: var(--text-success);">&#10003; Connected</span> — ` +
          `<code>${result.version}</code> at <code>${result.path}</code>`;
      } else if (result.found && !result.authenticated) {
        setting.descEl.innerHTML =
          `<span style="color: var(--text-warning);">&#9888; CLI found but not authenticated</span><br>` +
          `<code>${result.version}</code> at <code>${result.path}</code><br>` +
          `<span style="font-size: 11px;">Run <code>claude login</code> in your terminal to authenticate.</span>`;
      } else {
        setting.descEl.innerHTML =
          `<span style="color: var(--text-error);">&#10007; Not found</span><br>` +
          `<span style="font-size: 11px;">Install with: <code>npm install -g @anthropic-ai/claude-code</code></span>`;
      }
    } catch (err) {
      setting.descEl.setText(`Error checking CLI: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ================================================================
  // API KEY SETTINGS (Anthropic / OpenRouter / Bedrock / Vertex / Azure)
  // ================================================================

  private renderAPIKeySettings(containerEl: HTMLElement, provider: string): void {
    const isOpenRouter = provider === "openrouter";

    // Info box for the current provider
    const infoBox = containerEl.createDiv();
    if (isOpenRouter) {
      infoBox.innerHTML =
        '<div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); ' +
        'border-radius: var(--radius-m); padding: 12px; margin-bottom: 12px; font-size: 12px;">' +
        "<strong>OpenRouter</strong> gives you access to hundreds of models (Claude, GPT, Gemini, Llama, etc.) " +
        "through a single API key. Pay-per-use pricing. Get a key at " +
        '<a href="https://openrouter.ai/keys">openrouter.ai/keys</a>.' +
        "</div>";
    } else if (provider === "anthropic") {
      infoBox.innerHTML =
        '<div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); ' +
        'border-radius: var(--radius-m); padding: 12px; margin-bottom: 12px; font-size: 12px;">' +
        "<strong>Direct Anthropic API</strong> — pay-per-use with your own API key. " +
        "Get one at " +
        '<a href="https://console.anthropic.com">console.anthropic.com</a>. ' +
        "This is separate from a Claude Pro/Team subscription." +
        "</div>";
    }

    new Setting(containerEl)
      .setName("API key")
      .setDesc(
        isOpenRouter
          ? "Your OpenRouter API key"
          : `Your ${provider === "anthropic" ? "Anthropic" : provider} API key`
      )
      .addText((text) =>
        text
          .setPlaceholder(isOpenRouter ? "sk-or-..." : "sk-ant-...")
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

    containerEl.createEl("h2", { text: "Model" });
  }

  // ================================================================
  // MODEL SELECTORS
  // ================================================================

  private renderAnthropicModelSelector(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Model")
      .setDesc("Which Claude model to use")
      .addDropdown((dropdown) => {
        for (const [id, label] of Object.entries(ANTHROPIC_MODELS)) {
          dropdown.addOption(id, label);
        }
        dropdown
          .setValue(this.plugin.settings.model)
          .onChange(async (value: string) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          });
      });
  }

  private renderOpenRouterModelSelector(containerEl: HTMLElement): void {
    const setting = new Setting(containerEl)
      .setName("Model")
      .setDesc("Select a model from OpenRouter. Click refresh to fetch available models.");

    setting.addDropdown((dropdown) => {
      this.modelDropdownEl = dropdown.selectEl;

      const cached = this.plugin.settings.openRouterModelsCache;
      if (cached.length > 0) {
        this.populateModelDropdown(dropdown.selectEl, cached);
        dropdown.setValue(this.plugin.settings.model);
      } else {
        dropdown.addOption("", "-- Click refresh to load models --");
        dropdown.setDisabled(true);
      }

      dropdown.onChange(async (value: string) => {
        this.plugin.settings.model = value;
        await this.plugin.saveSettings();
      });
    });

    setting.addButton((btn) =>
      btn.setButtonText("Refresh models").onClick(async () => {
        btn.setButtonText("Loading...");
        btn.setDisabled(true);
        try {
          const models = await fetchOpenRouterModels();
          this.plugin.settings.openRouterModelsCache = models;
          this.plugin.settings.openRouterModelsCacheTime = Date.now();

          if (!models.some((m) => m.id === this.plugin.settings.model)) {
            const claude = models.find((m) => m.id.includes("claude-sonnet"));
            this.plugin.settings.model = claude?.id || models[0]?.id || "";
          }

          await this.plugin.saveSettings();

          if (this.modelDropdownEl) {
            this.populateModelDropdown(this.modelDropdownEl, models);
            this.modelDropdownEl.value = this.plugin.settings.model;
            this.modelDropdownEl.disabled = false;
          }

          if (this.lightModelDropdownEl) {
            this.populateModelDropdown(this.lightModelDropdownEl, models);
            this.lightModelDropdownEl.value = this.plugin.settings.lightModel;
            this.lightModelDropdownEl.disabled = false;
          }

          new Notice(`Loaded ${models.length} models from OpenRouter`);
        } catch (err) {
          new Notice(
            `Failed to fetch models: ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          btn.setButtonText("Refresh models");
          btn.setDisabled(false);
        }
      })
    );

    const cacheAge = Date.now() - this.plugin.settings.openRouterModelsCacheTime;
    if (this.plugin.settings.openRouterModelsCache.length === 0 || cacheAge > MODEL_CACHE_TTL) {
      this.autoFetchModels();
    }
  }

  private populateModelDropdown(selectEl: HTMLSelectElement, models: OpenRouterModel[]): void {
    selectEl.empty();
    for (const model of models) {
      const promptCost = parseFloat(model.pricing?.prompt || "0") * 1_000_000;
      const label = `${model.name} ($${promptCost.toFixed(2)}/M in)`;
      selectEl.createEl("option", { value: model.id, text: label });
    }
  }

  private async autoFetchModels(): Promise<void> {
    try {
      const models = await fetchOpenRouterModels();
      this.plugin.settings.openRouterModelsCache = models;
      this.plugin.settings.openRouterModelsCacheTime = Date.now();

      if (!models.some((m) => m.id === this.plugin.settings.model)) {
        const claude = models.find((m) => m.id.includes("claude-sonnet"));
        this.plugin.settings.model = claude?.id || models[0]?.id || "";
      }

      await this.plugin.saveSettings();

      if (this.modelDropdownEl) {
        this.populateModelDropdown(this.modelDropdownEl, models);
        this.modelDropdownEl.value = this.plugin.settings.model;
        this.modelDropdownEl.disabled = false;
      }

      if (this.lightModelDropdownEl) {
        this.populateModelDropdown(this.lightModelDropdownEl, models);
        this.lightModelDropdownEl.value = this.plugin.settings.lightModel;
        this.lightModelDropdownEl.disabled = false;
      }
    } catch {
      // Silent fail
    }
  }
}
