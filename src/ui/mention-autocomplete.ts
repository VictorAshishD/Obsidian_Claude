import { TFile, TFolder, type App } from "obsidian";

export interface MentionItem {
  type: "note" | "folder" | "tag";
  display: string;
  value: string;
  /** For notes: the file path. For tags: the tag string. */
  path: string;
}

export interface MentionContext {
  /** Content to prepend to the message as context */
  contextParts: Array<{ label: string; content: string }>;
}

/**
 * Manages @-mention autocomplete in the chat input.
 * Attaches to a textarea and shows a dropdown when @ is typed.
 */
export class MentionAutocomplete {
  private dropdown: HTMLElement | null = null;
  private items: MentionItem[] = [];
  private selectedIndex = 0;
  private mentionStart = -1;
  private resolvedMentions: MentionItem[] = [];
  private onMentionsChanged: (mentions: MentionItem[]) => void;
  private boundOnInput: () => void;
  private boundOnKeyDown: (e: KeyboardEvent) => void;
  private boundOnBlur: () => void;

  constructor(
    private app: App,
    private inputEl: HTMLTextAreaElement,
    private containerEl: HTMLElement,
    onMentionsChanged: (mentions: MentionItem[]) => void
  ) {
    this.onMentionsChanged = onMentionsChanged;
    this.boundOnInput = this.onInput.bind(this);
    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnBlur = () => {
      // Delay to allow click on dropdown item
      setTimeout(() => this.hideDropdown(), 200);
    };
    this.attachListeners();
  }

  /** Get all resolved mentions for the current message */
  getMentions(): MentionItem[] {
    return [...this.resolvedMentions];
  }

  /** Clear mentions (call when sending a message) */
  clearMentions(): void {
    this.resolvedMentions = [];
    this.onMentionsChanged(this.resolvedMentions);
  }

  /** Build context string from resolved mentions */
  async buildMentionContext(): Promise<MentionContext> {
    const contextParts: Array<{ label: string; content: string }> = [];

    for (const mention of this.resolvedMentions) {
      if (mention.type === "note") {
        const file = this.app.vault.getAbstractFileByPath(mention.path);
        if (file instanceof TFile) {
          const content = await this.app.vault.read(file);
          contextParts.push({
            label: `@${mention.display}`,
            content: `--- ${mention.path} ---\n${content}\n--- end ---`,
          });
        }
      } else if (mention.type === "folder") {
        const folder = this.app.vault.getAbstractFileByPath(mention.path);
        if (folder instanceof TFolder) {
          const children = folder.children;
          const listing = children
            .map((c) => ("children" in c ? `[DIR] ${c.name}` : c.name))
            .join("\n");
          contextParts.push({
            label: `@${mention.display}`,
            content: `--- Contents of ${mention.path}/ ---\n${listing}\n--- end ---`,
          });
        }
      } else if (mention.type === "tag") {
        // For tags, list files with that tag
        const tag = mention.value;
        const normalizedTag = tag.startsWith("#") ? tag : `#${tag}`;
        const files = this.app.vault.getMarkdownFiles();
        const matches: string[] = [];

        for (const file of files) {
          const cache = this.app.metadataCache.getFileCache(file);
          const tags = [
            ...(cache?.tags?.map((t) => t.tag) || []),
            ...(cache?.frontmatter?.tags?.map((t: string) => `#${t}`) || []),
          ];
          if (tags.some((t) => t === normalizedTag || t.startsWith(normalizedTag + "/"))) {
            matches.push(file.path);
            if (matches.length >= 20) break;
          }
        }

        contextParts.push({
          label: `@${mention.display}`,
          content: `--- Notes with tag ${normalizedTag} ---\n${matches.join("\n")}\n--- end ---`,
        });
      }
    }

    return { contextParts };
  }

  destroy(): void {
    this.inputEl.removeEventListener("input", this.boundOnInput);
    this.inputEl.removeEventListener("keydown", this.boundOnKeyDown);
    this.inputEl.removeEventListener("blur", this.boundOnBlur);
    this.hideDropdown();
  }

  // --- Private ---

  private attachListeners(): void {
    this.inputEl.addEventListener("input", this.boundOnInput);
    this.inputEl.addEventListener("keydown", this.boundOnKeyDown);
    this.inputEl.addEventListener("blur", this.boundOnBlur);
  }

  private onInput(): void {
    const cursorPos = this.inputEl.selectionStart;
    const text = this.inputEl.value;

    // Find the @ that started this mention
    const beforeCursor = text.slice(0, cursorPos);
    const atIndex = beforeCursor.lastIndexOf("@");

    if (atIndex === -1 || (atIndex > 0 && beforeCursor[atIndex - 1] !== " " && beforeCursor[atIndex - 1] !== "\n")) {
      this.hideDropdown();
      return;
    }

    const query = beforeCursor.slice(atIndex + 1);

    // Don't show if there's a space after @ with no query yet
    if (query.length === 0 && atIndex === cursorPos - 1) {
      this.mentionStart = atIndex;
      this.searchItems("");
      return;
    }

    if (query.includes("\n")) {
      this.hideDropdown();
      return;
    }

    this.mentionStart = atIndex;
    this.searchItems(query);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.dropdown || this.items.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
        this.renderDropdown();
        break;
      case "ArrowUp":
        e.preventDefault();
        this.selectedIndex =
          (this.selectedIndex - 1 + this.items.length) % this.items.length;
        this.renderDropdown();
        break;
      case "Enter":
      case "Tab":
        if (this.items.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          this.selectItem(this.items[this.selectedIndex]);
        }
        break;
      case "Escape":
        this.hideDropdown();
        break;
    }
  }

  private searchItems(query: string): void {
    const lowerQuery = query.toLowerCase();
    const results: MentionItem[] = [];

    // Search notes
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (
        file.basename.toLowerCase().includes(lowerQuery) ||
        file.path.toLowerCase().includes(lowerQuery)
      ) {
        results.push({
          type: "note",
          display: file.basename,
          value: file.basename,
          path: file.path,
        });
      }
      if (results.length >= 8) break;
    }

    // Search folders
    const allFiles = this.app.vault.getAllLoadedFiles();
    for (const item of allFiles) {
      if ("children" in item && item.path) {
        if (item.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            type: "folder",
            display: item.name + "/",
            value: item.name,
            path: item.path,
          });
        }
      }
      if (results.length >= 12) break;
    }

    // Search tags
    const tagSet = new Set<string>();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      for (const t of cache?.tags || []) {
        if (t.tag.toLowerCase().includes(lowerQuery)) tagSet.add(t.tag);
      }
      if (cache?.frontmatter?.tags) {
        for (const t of cache.frontmatter.tags) {
          const tag = `#${t}`;
          if (tag.toLowerCase().includes(lowerQuery)) tagSet.add(tag);
        }
      }
    }
    for (const tag of [...tagSet].slice(0, 5)) {
      results.push({
        type: "tag",
        display: tag,
        value: tag,
        path: tag,
      });
    }

    this.items = results.slice(0, 15);
    this.selectedIndex = 0;

    if (this.items.length > 0) {
      this.showDropdown();
    } else {
      this.hideDropdown();
    }
  }

  private selectItem(item: MentionItem): void {
    // Replace the @query with the selected mention
    const text = this.inputEl.value;
    const cursorPos = this.inputEl.selectionStart;
    const before = text.slice(0, this.mentionStart);
    const after = text.slice(cursorPos);

    const mentionText = `@${item.display} `;
    this.inputEl.value = before + mentionText + after;
    this.inputEl.selectionStart = this.inputEl.selectionEnd =
      this.mentionStart + mentionText.length;

    // Track this mention
    if (!this.resolvedMentions.some((m) => m.path === item.path && m.type === item.type)) {
      this.resolvedMentions.push(item);
      this.onMentionsChanged(this.resolvedMentions);
    }

    this.hideDropdown();
    this.inputEl.focus();
  }

  private showDropdown(): void {
    if (!this.dropdown) {
      this.dropdown = this.containerEl.createDiv("vault-claude-mention-dropdown");
    }
    this.renderDropdown();
  }

  private renderDropdown(): void {
    if (!this.dropdown) return;
    this.dropdown.empty();

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const el = this.dropdown.createDiv({
        cls: `vault-claude-mention-item ${i === this.selectedIndex ? "is-selected" : ""}`,
      });

      const icon = el.createSpan("vault-claude-mention-icon");
      icon.setText(item.type === "note" ? "📄" : item.type === "folder" ? "📁" : "#");

      const label = el.createSpan("vault-claude-mention-label");
      label.setText(item.display);

      if (item.type === "note") {
        const path = el.createSpan("vault-claude-mention-path");
        path.setText(item.path);
      }

      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.selectItem(item);
      });
    }
  }

  private hideDropdown(): void {
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
    }
    this.items = [];
  }
}
