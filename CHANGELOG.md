# Changelog

All notable changes to Vault Claude will be documented in this file.

## [0.1.0] - 2026-03-18

### Added

- **Sidebar chat panel** with full markdown rendering, streaming responses, and tool call cards
- **Three connection modes:**
  - Claude Code CLI (uses existing installation and subscription — no API key needed)
  - Anthropic API (direct, pay-per-use)
  - OpenRouter (access to 200+ models including Claude, GPT, Gemini, Llama)
- **11 Obsidian-native tools:** read_note, write_note, edit_note, search_vault, list_files, get_active_note, get_backlinks, get_tags, get_frontmatter, get_vault_structure, get_daily_note, resolve_wikilinks
- **10 slash commands:** /summarize, /outline, /rewrite, /translate, /ask, /tags, /links, /daily, /fixup, /extract
- **@-mention autocomplete** for notes, folders, and tags
- **Inline diff review** with accept/reject buttons for file edits
- **Conversation persistence** — save, load, and delete past conversations
- **Plan mode** — Claude proposes steps before executing
- **Cost tracking** — per-conversation token usage with cost estimates
- **Keyboard shortcuts** — Ctrl+Shift+L (toggle), Ctrl+Shift+N (new chat), Escape (stop)
- **Settings page** with provider-specific UI, CLI status detection, and clear setup instructions
- **Full theme compatibility** using Obsidian CSS variables
