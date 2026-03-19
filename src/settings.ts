import { App, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type VaultClaudePlugin from "./main";
import { detectClaudeCLI, type CLIDetectionResult } from "./agent/claude-cli-client";
import { fetchOllamaModels } from "./agent/openrouter-client";

export type PermissionMode = "auto" | "approve-edits" | "plan-only";

export type AuthProvider = "claude-cli" | "anthropic" | "openai" | "openrouter" | "ollama";

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
  ollamaUrl: string;
  ollamaModelsCache: string[];
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
  ollamaUrl: "http://localhost:11434",
  ollamaModelsCache: [],
};

const ANTHROPIC_MODELS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "Haiku 4.5 (fastest, cheapest)",
  "claude-sonnet-4-6": "Sonnet 4.6 (balanced)",
  "claude-opus-4-6": "Opus 4.6 (most capable)",
};

const OPENAI_MODELS: Record<string, string> = {
  "gpt-4.1": "GPT-4.1 (most capable)",
  "gpt-4.1-mini": "GPT-4.1 Mini (balanced)",
  "gpt-4.1-nano": "GPT-4.1 Nano (fastest, cheapest)",
  "o4-mini": "o4-mini (reasoning)",
  "gpt-4o": "GPT-4o (legacy)",
  "gpt-4o-mini": "GPT-4o Mini (legacy)",
};

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const MODEL_CACHE_TTL = 1000 * 60 * 60; // 1 hour

/** Helper to build a styled info box using DOM APIs */
function createInfoBox(containerEl: HTMLElement, fragments: Array<{ text?: string; tag?: string; bold?: boolean; code?: boolean; href?: string; br?: boolean }>): void {
  const box = containerEl.createDiv({ cls: "vault-claude-info-box" });
  for (const frag of fragments) {
    if (frag.br) {
      box.createEl("br");
    } else if (frag.code) {
      box.createEl("code", { text: frag.text });
    } else if (frag.bold) {
      box.createEl("strong", { text: frag.text });
    } else if (frag.href) {
      box.createEl("a", { text: frag.text, href: frag.href });
    } else if (frag.text) {
      box.appendText(frag.text);
    }
  }
}

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
    new Setting(containerEl).setName("Connection mode").setHeading();

    new Setting(containerEl)
      .setName("Connection mode")
      .setDesc(
        "Choose how Vault Claude connects to AI. Use your existing Claude Code installation " +
        "or connect directly via API key for more control."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("claude-cli", "Claude Code CLI (uses your existing login)")
          .addOption("anthropic", "Anthropic API key (Claude)")
          .addOption("openai", "OpenAI API key (GPT)")
          .addOption("openrouter", "OpenRouter API key (200+ models)")
          .addOption("ollama", "Ollama (local models, free)")
          .setValue(this.plugin.settings.authProvider)
          .onChange(async (value: string) => {
            this.plugin.settings.authProvider = value as AuthProvider;
            if (value === "openai") {
              this.plugin.settings.model = "gpt-4.1-mini";
            } else if (value === "anthropic") {
              this.plugin.settings.model = "claude-sonnet-4-6";
            } else if (value === "ollama") {
              this.plugin.settings.model = this.plugin.settings.ollamaModelsCache[0] || "";
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
    } else if (provider === "openai") {
      this.renderAPIKeySettings(containerEl, "openai");
      this.renderOpenAIModelSelector(containerEl);
    } else if (provider === "ollama") {
      this.renderOllamaSettings(containerEl);
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
    new Setting(containerEl).setName("Two-tiered model system").setHeading();

    new Setting(containerEl)
      .setName("About")
      .setDesc(
        "Some quick tasks (tagging, TOC, readability, links) use a lighter, cheaper model " +
        "to save cost and respond faster. Complex tasks use your primary model."
      );

    if (provider === "openrouter") {
      const lightSetting = new Setting(containerEl)
        .setName("Light model")
        .setDesc("Used for quick tasks. Select from your OpenRouter models.");

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
    } else if (provider === "ollama") {
      new Setting(containerEl)
        .setName("Light model")
        .setDesc("Used for quick tasks. Select from your local Ollama models.")
        .addDropdown((dropdown) => {
          const cached = this.plugin.settings.ollamaModelsCache;
          if (cached.length > 0) {
            for (const m of cached) dropdown.addOption(m, m);
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
      const modelList = provider === "openai" ? OPENAI_MODELS : ANTHROPIC_MODELS;
      new Setting(containerEl)
        .setName("Light model")
        .setDesc("Used for quick tasks (tags, TOC, links, readability)")
        .addDropdown((dropdown) => {
          for (const [id, label] of Object.entries(modelList)) {
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
    new Setting(containerEl).setName("Permissions").setHeading();

    new Setting(containerEl)
      .setName("Permission mode")
      .setDesc("How the assistant handles file modifications")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto (no confirmations)")
          .addOption("approve-edits", "Approve edits (confirm writes)")
          .addOption("plan-only", "Plan only (propose, don't execute)")
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (value: string) => {
            this.plugin.settings.permissionMode = value as PermissionMode;
            await this.plugin.saveSettings();
          })
      );

    // ================================================================
    // BEHAVIOR
    // ================================================================
    new Setting(containerEl).setName("Behavior").setHeading();

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
    new Setting(containerEl).setName("Custom system prompt").setHeading();

    new Setting(containerEl)
      .setName("System prompt")
      .setDesc("Additional instructions prepended to every conversation. Leave blank to use defaults.")
      .addTextArea((text) =>
        text
          .setPlaceholder("You are an expert assistant for my Obsidian vault...")
          .setValue(this.plugin.settings.systemPrompt)
          .then((t) => {
            t.inputEl.rows = 6;
            t.inputEl.addClass("vault-claude-textarea-wide");
          })
          .onChange(async (value: string) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    // ================================================================
    // SAVE BUTTON
    // ================================================================
    const saveSection = containerEl.createDiv({ cls: "vault-claude-save-section" });

    const savedMsg = saveSection.createSpan({ cls: "vault-claude-saved-msg" });
    savedMsg.setText("\u2713 Settings saved");

    const saveBtn = saveSection.createEl("button", {
      text: "Save settings",
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", async () => {
      await this.plugin.saveSettings();
      this.plugin.agentService.initialize();
      savedMsg.addClass("is-visible");
      setTimeout(() => {
        savedMsg.removeClass("is-visible");
      }, 2000);
      new Notice("Vault Claude settings saved");
    });
  }

  // ================================================================
  // CLAUDE CODE CLI SETTINGS
  // ================================================================

  private renderCLISettings(containerEl: HTMLElement): void {
    createInfoBox(containerEl, [
      { bold: true, text: "How this works: " },
      { text: "Vault Claude sends prompts to the Claude Code CLI (" },
      { code: true, text: "claude -p" },
      { text: ") installed on your system. This uses your existing Claude subscription \u2014 no separate API key needed." },
      { br: true },
      { br: true },
      { bold: true, text: "Requirements:" },
      { br: true },
      { text: "1. Claude Code CLI installed (" },
      { code: true, text: "npm install -g @anthropic-ai/claude-code" },
      { text: ")" },
      { br: true },
      { text: "2. Authenticated (" },
      { code: true, text: "claude login" },
      { text: " in your terminal)" },
      { br: true },
      { text: "3. Active Claude subscription (Pro, Team, or Enterprise)" },
    ]);

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
    void this.checkCLIStatus(statusSetting);

    // Model selection (CLI supports these natively)
    new Setting(containerEl).setName("Model").setHeading();

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
        const span = setting.descEl.createSpan({ cls: "vault-claude-status-ok" });
        span.setText("\u2713 Connected");
        setting.descEl.appendText(" \u2014 ");
        setting.descEl.createEl("code", { text: result.version || "" });
        setting.descEl.appendText(" at ");
        setting.descEl.createEl("code", { text: result.path || "" });
      } else if (result.found && !result.authenticated) {
        const span = setting.descEl.createSpan({ cls: "vault-claude-status-warn" });
        span.setText("\u26A0 CLI found but not authenticated");
        setting.descEl.createEl("br");
        setting.descEl.createEl("code", { text: result.version || "" });
        setting.descEl.appendText(" at ");
        setting.descEl.createEl("code", { text: result.path || "" });
        setting.descEl.createEl("br");
        setting.descEl.appendText("Run ");
        setting.descEl.createEl("code", { text: "claude login" });
        setting.descEl.appendText(" in your terminal to authenticate.");
      } else {
        const span = setting.descEl.createSpan({ cls: "vault-claude-status-err" });
        span.setText("\u2717 Not found");
        setting.descEl.createEl("br");
        setting.descEl.appendText("Install with: ");
        setting.descEl.createEl("code", { text: "npm install -g @anthropic-ai/claude-code" });
      }
    } catch (err) {
      setting.descEl.setText(`Error checking CLI: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ================================================================
  // API KEY SETTINGS
  // ================================================================

  private renderAPIKeySettings(containerEl: HTMLElement, provider: string): void {
    const isOpenRouter = provider === "openrouter";
    const isOpenAI = provider === "openai";

    if (isOpenRouter) {
      createInfoBox(containerEl, [
        { bold: true, text: "OpenRouter" },
        { text: " gives you access to hundreds of models (Claude, GPT, Gemini, Llama, etc.) through a single API key. Pay-per-use pricing. Get a key at " },
        { href: "https://openrouter.ai/keys", text: "openrouter.ai/keys" },
        { text: "." },
      ]);
    } else if (isOpenAI) {
      createInfoBox(containerEl, [
        { bold: true, text: "OpenAI API" },
        { text: " \u2014 access GPT-4.1, o4-mini, and other OpenAI models directly. Pay-per-use with your own API key. Get one at " },
        { href: "https://platform.openai.com/api-keys", text: "platform.openai.com/api-keys" },
        { text: "." },
      ]);
    } else {
      createInfoBox(containerEl, [
        { bold: true, text: "Direct Anthropic API" },
        { text: " \u2014 pay-per-use with your own API key. Get one at " },
        { href: "https://console.anthropic.com", text: "console.anthropic.com" },
        { text: ". This is separate from a Claude Pro/Team subscription." },
      ]);
    }

    const placeholder = isOpenRouter ? "sk-or-..." : isOpenAI ? "sk-..." : "sk-ant-...";
    const providerLabel = isOpenRouter ? "OpenRouter" : isOpenAI ? "OpenAI" : "Anthropic";

    new Setting(containerEl)
      .setName("API key")
      .setDesc(`Your ${providerLabel} API key`)
      .addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings.apiKey)
          .then((t) => {
            t.inputEl.type = "password";
            t.inputEl.addClass("vault-claude-input-wide");
          })
          .onChange(async (value: string) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Model").setHeading();
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

  private renderOpenAIModelSelector(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Model")
      .setDesc("Which OpenAI model to use")
      .addDropdown((dropdown) => {
        for (const [id, label] of Object.entries(OPENAI_MODELS)) {
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

  private renderOllamaSettings(containerEl: HTMLElement): void {
    createInfoBox(containerEl, [
      { bold: true, text: "Ollama" },
      { text: " runs AI models locally on your machine \u2014 completely free, no API key needed. Install from " },
      { href: "https://ollama.com", text: "ollama.com" },
      { text: ", then pull a model (" },
      { code: true, text: "ollama pull llama3.2" },
      { text: ") and make sure Ollama is running." },
    ]);

    new Setting(containerEl)
      .setName("Ollama URL")
      .setDesc("The URL where Ollama is running")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.ollamaUrl)
          .then((t) => { t.inputEl.addClass("vault-claude-input-wide"); })
          .onChange(async (value: string) => {
            this.plugin.settings.ollamaUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Model").setHeading();

    const modelSetting = new Setting(containerEl)
      .setName("Model")
      .setDesc("Select a locally installed Ollama model. Click refresh to detect models.");

    const dropdownState: { el: HTMLSelectElement | null } = { el: null };

    modelSetting.addDropdown((dropdown) => {
      dropdownState.el = dropdown.selectEl;
      const cached = this.plugin.settings.ollamaModelsCache;
      if (cached.length > 0) {
        for (const m of cached) dropdown.addOption(m, m);
        dropdown.setValue(this.plugin.settings.model);
      } else {
        dropdown.addOption("", "-- Click refresh to detect models --");
        dropdown.setDisabled(true);
      }
      dropdown.onChange(async (value: string) => {
        this.plugin.settings.model = value;
        await this.plugin.saveSettings();
      });
    });

    modelSetting.addButton((btn) =>
      btn.setButtonText("Refresh models").onClick(async () => {
        btn.setButtonText("Detecting...");
        btn.setDisabled(true);
        try {
          const models = await fetchOllamaModels(this.plugin.settings.ollamaUrl);
          const modelNames = models.map((m) => m.name);
          this.plugin.settings.ollamaModelsCache = modelNames;

          if (!modelNames.includes(this.plugin.settings.model)) {
            this.plugin.settings.model = modelNames[0] || "";
          }

          await this.plugin.saveSettings();

          if (dropdownState.el) {
            dropdownState.el.empty();
            for (const name of modelNames) {
              dropdownState.el.createEl("option", { value: name, text: name });
            }
            dropdownState.el.value = this.plugin.settings.model;
            dropdownState.el.disabled = false;
          }

          new Notice(`Found ${String(modelNames.length)} Ollama model${modelNames.length !== 1 ? "s" : ""}`);
        } catch (err) {
          new Notice(
            `Failed to detect Ollama models: ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          btn.setButtonText("Refresh models");
          btn.setDisabled(false);
        }
      })
    );

    // Auto-detect on render if cache is empty
    if (this.plugin.settings.ollamaModelsCache.length === 0) {
      void (async () => {
        try {
          const models = await fetchOllamaModels(this.plugin.settings.ollamaUrl);
          const modelNames = models.map((m) => m.name);
          this.plugin.settings.ollamaModelsCache = modelNames;
          if (!modelNames.includes(this.plugin.settings.model)) {
            this.plugin.settings.model = modelNames[0] || "";
          }
          await this.plugin.saveSettings();
          if (dropdownState.el) {
            dropdownState.el.empty();
            for (const name of modelNames) {
              dropdownState.el.createEl("option", { value: name, text: name });
            }
            dropdownState.el.value = this.plugin.settings.model;
            dropdownState.el.disabled = false;
          }
        } catch {
          // Silent — user will use Refresh button
        }
      })();
    }
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

          new Notice(`Loaded ${String(models.length)} models from OpenRouter`);
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
      void this.autoFetchModels();
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
