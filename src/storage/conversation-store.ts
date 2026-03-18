import type { App } from "obsidian";
import type { ChatMessage } from "../agent/agent-service";

const STORAGE_DIR = ".vault-claude/conversations";

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model: string;
}

export interface SavedConversation extends ConversationMeta {
  messages: ChatMessage[];
}

export class ConversationStore {
  constructor(private app: App) {}

  /** Ensure the storage directory exists */
  async ensureDir(): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(STORAGE_DIR);
    if (!folder) {
      await this.app.vault.createFolder(STORAGE_DIR);
    }
    // Also ensure parent exists
    const parent = this.app.vault.getAbstractFileByPath(".vault-claude");
    if (!parent) {
      await this.app.vault.createFolder(".vault-claude");
    }
  }

  /** Save a conversation */
  async save(conversation: SavedConversation): Promise<void> {
    await this.ensureDir();
    const path = `${STORAGE_DIR}/${conversation.id}.json`;
    const content = JSON.stringify(conversation, null, 2);

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && "extension" in existing) {
      await this.app.vault.modify(existing as import("obsidian").TFile, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  /** Load a conversation by ID */
  async load(id: string): Promise<SavedConversation | null> {
    const path = `${STORAGE_DIR}/${id}.json`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !("extension" in file)) return null;

    const content = await this.app.vault.read(file as import("obsidian").TFile);
    try {
      return JSON.parse(content) as SavedConversation;
    } catch {
      return null;
    }
  }

  /** List all saved conversations (most recent first) */
  async list(): Promise<ConversationMeta[]> {
    await this.ensureDir();
    const folder = this.app.vault.getAbstractFileByPath(STORAGE_DIR);
    if (!folder || !("children" in folder)) return [];

    const conversations: ConversationMeta[] = [];
    const children = (folder as import("obsidian").TFolder).children;

    for (const child of children) {
      if (!("extension" in child) || (child as import("obsidian").TFile).extension !== "json") continue;

      try {
        const content = await this.app.vault.read(child as import("obsidian").TFile);
        const data = JSON.parse(content) as SavedConversation;
        conversations.push({
          id: data.id,
          title: data.title,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          messageCount: data.messageCount,
          model: data.model,
        });
      } catch {
        // Skip invalid files
      }
    }

    return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Delete a conversation */
  async delete(id: string): Promise<void> {
    const path = `${STORAGE_DIR}/${id}.json`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      await this.app.vault.delete(file);
    }
  }

  /** Generate a title from the first user message */
  static generateTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser) return "New Conversation";
    const text = firstUser.content.trim();
    if (text.length <= 50) return text;
    return text.slice(0, 47) + "...";
  }

  /** Generate a unique conversation ID */
  static generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
