# Changelog

All notable changes to Obsidian Claude will be documented in this file.

## [0.2.0] - 2026-03-19

### Added
- **OpenAI API provider** — connect directly with your OpenAI API key (GPT-4.1, o4-mini, GPT-4o, etc.)
- **Ollama (local) provider** — run models locally with no API key, auto-detects installed models
- **Insert to document** button on AI messages — one click to paste response into your active note
- **Message selection with summarize** — check multiple messages, click "Summarize to document" for AI-synthesized summaries inserted into your note
- **Export conversation as note** — save full chat as a markdown file with frontmatter in your vault
- **Real-time SSE streaming** for OpenRouter, OpenAI, and Ollama providers
- **OpenAI model cost tracking** (GPT-4.1, o4-mini, GPT-4o pricing)
- **Ollama token display** — shows token counts as "local" (free)

### Improved
- **Debounced markdown rendering** — 80ms batched updates instead of per-token, much smoother on lower-end devices
- **Tool result truncation** — 4K character limit on tool outputs to protect context window
- **Conversation history trimming** — enforces configurable message limit to prevent memory growth
- **AbortController signal wiring** — cancel streaming requests cleanly across all providers

### Fixed
- All Obsidian community plugin review bot issues: no innerHTML, no inline styles, instanceof checks for TFile/TFolder, void for fire-and-forget promises, Setting.setHeading() for headings, sentence case UI text, no default hotkeys, FileManager.trashFile() for deletion
- Anthropic streaming now uses real-time `stream.on("text")` events instead of waiting for `finalMessage()`
- Removed unsafe `as any` casts throughout codebase

## [0.1.0] - 2026-03-18

### Added

- **Sidebar chat panel** with full markdown rendering, streaming responses, and tool call cards
- **Three connection modes:**
  - Claude Code CLI (uses existing installation and subscription — no API key needed)
  - Anthropic API (direct, pay-per-use)
  - OpenRouter (access to 200+ models including Claude, GPT, Gemini, Llama)
- **Two-tiered model system** — assign separate primary and light models for cost-efficient routing
- **11 Obsidian-native tools:** read_note, write_note, edit_note, search_vault, list_files, get_active_note, get_backlinks, get_tags, get_frontmatter, get_vault_structure, get_daily_note, resolve_wikilinks
- **30+ slash commands** across 6 categories: writing, editing, analysis, research, organization, vault management
- **@-mention autocomplete** for notes, folders, and tags
- **Inline diff review** with accept/reject buttons for file edits
- **Conversation persistence** — save, load, and delete past conversations
- **Plan mode** — Claude proposes steps before executing
- **Cost tracking** — per-conversation token usage with cost estimates
- **Keyboard shortcuts** — Ctrl+Shift+L (toggle), Ctrl+Shift+N (new chat), Escape (stop)
- **Settings page** with provider-specific UI, CLI status detection, save button, and clear setup instructions
- **Full theme compatibility** using Obsidian CSS variables
