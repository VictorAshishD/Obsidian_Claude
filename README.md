# Obsidian Claude

**Agentic AI assistant for Obsidian — chat with Claude to read, write, search, and transform your notes using natural language.**

Obsidian Claude embeds a powerful AI assistant in your sidebar. It can read, write, search, and transform your notes using natural language. Unlike generic AI chat plugins, Obsidian Claude understands Obsidian — it knows about wikilinks, frontmatter, backlinks, tags, daily notes, and your vault's folder structure.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Desktop%20only-orange)

---

## Features

### Three Connection Modes

| Mode | What it uses | Cost | Best for |
|------|-------------|------|----------|
| **Claude Code CLI** | Your existing `claude` installation | Included with Claude subscription | Users who already have Claude Code |
| **Anthropic API** | Direct API key | Pay-per-use | Full control, specific model selection |
| **OpenRouter** | OpenRouter API key | Pay-per-use | Access to 200+ models (Claude, GPT, Gemini, Llama, etc.) |

### Two-Tiered Model System

Assign a **primary model** for complex tasks and a **light model** for quick, cheap operations (tagging, TOC generation, readability checks, finding links). Saves cost without sacrificing quality where it matters.

### Sidebar Chat Panel
- Full markdown rendering in responses
- Streaming responses (API modes)
- Tool call cards showing what Claude is doing (file reads, searches, edits)
- Token usage and cost tracking
- Conversation history — save, load, and delete past chats

### 11 Obsidian-Native Tools

Claude doesn't just see your files — it understands your vault:

| Tool | What it does |
|------|-------------|
| `read_note` | Read any note's content including frontmatter |
| `write_note` | Create new notes or overwrite existing ones |
| `edit_note` | Make targeted edits (find and replace) |
| `search_vault` | Full-text search across all notes |
| `list_files` | Browse folder contents |
| `get_active_note` | Get the currently open note with metadata |
| `get_backlinks` | Find all notes linking to a given note |
| `get_tags` | List all tags or find notes by tag |
| `get_frontmatter` | Read YAML frontmatter as structured data |
| `get_vault_structure` | Get the full folder tree with note counts |
| `get_daily_note` | Access daily notes by date |
| `resolve_wikilinks` | Resolve `[[wikilinks]]` to file paths |

### 30+ Slash Commands

Type `/` in the chat to access commands organized by category:

| Category | Commands |
|----------|----------|
| **Writing** | `/brainstorm`, `/wordsmith`, `/expand`, `/draft`, `/headline`, `/metaphor`, `/dialogue`, `/hook`, `/conclude` |
| **Editing** | `/summarize`, `/outline`, `/rewrite`, `/fixup`, `/shorten`, `/tone`, `/translate` |
| **Analysis** | `/critique`, `/counterargument`, `/audience`, `/readability` |
| **Research** | `/ask`, `/find-hyperlinks`, `/research`, `/connect`, `/bibliography` |
| **Organization** | `/tags`, `/links`, `/toc`, `/frontmatter`, `/daily`, `/extract`, `/merge`, `/audit` |

All slash commands are also available in Obsidian's command palette (Ctrl+P).

### @-Mention Context

Type `@` in the chat to reference specific notes, folders, or tags. Their content is attached as context to your message. This lets you ask questions like:

> Tell me how @ProjectNotes and @MeetingNotes/March relate to each other

### Inline Diff Review

When Claude proposes file edits (in "Approve Edits" mode), changes are shown as inline diffs with:
- Line-by-line additions (green) and removals (red)
- Accept / Reject buttons per edit
- Change statistics (+N / -N)

### Permission Modes

| Mode | Behavior |
|------|----------|
| **Auto** | Claude executes all operations without asking |
| **Approve Edits** | Read/search freely, but file modifications show diffs for review |
| **Plan Only** | Claude proposes a numbered plan, no execution until approved |

### Cost Tracking

- Per-conversation token count with cost estimates
- Hover the counter for a detailed breakdown (input/output tokens, costs)
- Supports pricing for all Anthropic and OpenRouter models

---

## Installation

### From Community Plugins (Recommended)

1. Open **Settings > Community Plugins** in Obsidian
2. Search for **Obsidian Claude**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/VictorDasari/obsidian-claude/releases)
2. Create a folder: `.obsidian/plugins/obsidian-claude/`
3. Copy the three files into that folder
4. Enable the plugin in **Settings > Community Plugins**

### Development

```bash
cd "Softwares/Vault Claude"
npm install
npm run dev      # Watch mode (auto-rebuilds)
npm run build    # Production build
```

After building, copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/obsidian-claude/`.

---

## Setup

### Option 1: Claude Code CLI (No API Key Needed)

If you already have Claude Code installed and a Claude subscription:

1. Ensure Claude Code CLI is installed: `npm install -g @anthropic-ai/claude-code`
2. Authenticate: `claude login`
3. In plugin settings, select **Claude Code CLI** as connection mode
4. The status indicator will show green when connected

This uses your existing subscription — no additional cost.

### Option 2: Anthropic API Key

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In plugin settings, select **Anthropic API Key** as connection mode
3. Paste your key (stored locally in plugin data)
4. Select your preferred model (Haiku, Sonnet, or Opus)

### Option 3: OpenRouter

1. Get an API key from [openrouter.ai/keys](https://openrouter.ai/keys)
2. In plugin settings, select **OpenRouter API Key** as connection mode
3. Paste your key
4. Click **Refresh models** to load all available models
5. Select any model — Claude, GPT-4, Gemini, Llama, Mistral, and hundreds more

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+L` | Toggle the chat sidebar |
| `Ctrl+Shift+N` | Start a new conversation |
| `Escape` | Stop current generation |

---

## Architecture

```
src/
├── main.ts                      # Plugin entry point
├── settings.ts                  # Settings tab with provider-specific UI
├── agent/
│   ├── agent-service.ts         # Core agent with Anthropic + OpenRouter + CLI routing
│   ├── claude-cli-client.ts     # Claude Code CLI subprocess wrapper
│   ├── openrouter-client.ts     # OpenRouter API client (OpenAI format)
│   └── obsidian-tools.ts        # 11 Obsidian-native tool definitions
├── commands/
│   └── slash-commands.ts        # 30+ slash commands with two-tiered model routing
├── storage/
│   └── conversation-store.ts    # Conversation persistence (.obsidian-claude/conversations/)
└── ui/
    ├── chat-view.ts             # Sidebar chat panel (ItemView)
    ├── cost-tracker.ts          # Token usage and cost estimation
    ├── diff-view.ts             # Inline diff rendering with accept/reject
    └── mention-autocomplete.ts  # @-mention autocomplete dropdown
```

### How It Works

**API modes (Anthropic / OpenRouter):** The plugin implements an agentic tool-use loop. It sends your message to the API along with tool definitions. When Claude wants to read a file, search, or edit, it returns a tool call. The plugin executes the tool using Obsidian's vault API and sends the result back. This loop continues until Claude has a final response.

**CLI mode:** The plugin spawns `claude -p "your message"` as a subprocess, with the vault as the working directory. Claude Code handles its own tool execution (file I/O, search, bash). The final result is returned to the chat UI.

### Data Storage

- **Settings**: Stored in `.obsidian/plugins/obsidian-claude/data.json` (Obsidian's standard plugin data)
- **Conversations**: Saved to `.obsidian-claude/conversations/*.json` within your vault
- **API keys**: Stored locally in plugin data — never transmitted except to your configured API provider

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Author

**Victor Dasari** — [victordasari.com](https://victordasari.com)

Built with Claude Code.
