import { TFile, TFolder, type App } from "obsidian";

// --- Types ---

export interface ToolResult {
  success: boolean;
  result: string;
}

export interface ObsidianTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}

// --- Result Truncation ---

const MAX_RESULT_CHARS = 4000;

function truncateResult(result: string): string {
  if (result.length <= MAX_RESULT_CHARS) return result;
  const kept = result.substring(0, MAX_RESULT_CHARS);
  const truncatedLines = result.substring(MAX_RESULT_CHARS).split("\n").length;
  return `${kept}\n\n[... truncated ${String(truncatedLines)} more lines. Use read_note with a specific path to see the full content.]`;
}

// --- Tool Definitions ---

export function getObsidianTools(app: App): ObsidianTool[] {
  return [
    // --- Read File ---
    {
      name: "read_note",
      description:
        "Read the full content of a note in the vault. Returns the raw markdown including frontmatter.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'Path to the note relative to vault root (e.g. "DailyNotes/March 18, 2026.md")',
          },
        },
        required: ["path"],
      },
      execute: async (input) => {
        const path = input.path as string;
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${path}` };
        }
        const content = await app.vault.read(file);
        return { success: true, result: truncateResult(content) };
      },
    },

    // --- Write File ---
    {
      name: "write_note",
      description:
        "Create a new note or overwrite an existing note with the given content. Creates parent folders if needed.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path for the note relative to vault root",
          },
          content: {
            type: "string",
            description: "Full markdown content to write (including frontmatter if needed)",
          },
        },
        required: ["path", "content"],
      },
      execute: async (input) => {
        const path = input.path as string;
        const content = input.content as string;

        // Ensure parent directory exists
        const dir = path.substring(0, path.lastIndexOf("/"));
        if (dir) {
          const folder = app.vault.getAbstractFileByPath(dir);
          if (!folder) {
            await app.vault.createFolder(dir);
          }
        }

        const existing = app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
          await app.vault.modify(existing, content);
          return { success: true, result: `Updated: ${path}` };
        } else {
          await app.vault.create(path, content);
          return { success: true, result: `Created: ${path}` };
        }
      },
    },

    // --- Edit File (partial) ---
    {
      name: "edit_note",
      description:
        "Make a targeted edit to an existing note by replacing a specific string. Use this instead of write_note when you only need to change part of a file.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the note relative to vault root",
          },
          old_string: {
            type: "string",
            description: "The exact text to find and replace (must be unique in the file)",
          },
          new_string: {
            type: "string",
            description: "The replacement text",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
      execute: async (input) => {
        const path = input.path as string;
        const oldStr = input.old_string as string;
        const newStr = input.new_string as string;

        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { success: false, result: `File not found: ${path}` };
        }

        const content = await app.vault.read(file);
        const occurrences = content.split(oldStr).length - 1;

        if (occurrences === 0) {
          return { success: false, result: `String not found in ${path}` };
        }
        if (occurrences > 1) {
          return {
            success: false,
            result: `String appears ${String(occurrences)} times in ${path}. Provide more context to make it unique.`,
          };
        }

        const newContent = content.replace(oldStr, newStr);
        await app.vault.modify(file, newContent);
        return { success: true, result: `Edited ${path}: replaced 1 occurrence` };
      },
    },

    // --- Search Vault ---
    {
      name: "search_vault",
      description:
        "Search for notes containing a text query. Returns matching file paths and the lines that matched.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for across all notes",
          },
          max_results: {
            type: "number",
            description: "Maximum number of matching files to return (default: 20)",
          },
        },
        required: ["query"],
      },
      execute: async (input) => {
        const query = (input.query as string).toLowerCase();
        const maxResults = (input.max_results as number) || 20;
        const files = app.vault.getMarkdownFiles();
        const results: string[] = [];

        for (const file of files) {
          if (results.length >= maxResults) break;
          const content = await app.vault.cachedRead(file);
          const lines = content.split("\n");
          const matchingLines: string[] = [];

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query)) {
              matchingLines.push(`  L${String(i + 1)}: ${lines[i].trim().substring(0, 200)}`);
              if (matchingLines.length >= 3) break; // max 3 lines per file
            }
          }

          if (matchingLines.length > 0) {
            results.push(`${file.path}\n${matchingLines.join("\n")}`);
          }
        }

        if (results.length === 0) {
          return { success: true, result: `No results found for "${String(input.query)}"` };
        }
        return {
          success: true,
          result: `Found ${String(results.length)} matching files:\n\n${results.join("\n\n")}`,
        };
      },
    },

    // --- List Files ---
    {
      name: "list_files",
      description:
        "List files and folders in a directory. If no path is given, lists the vault root.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Folder path relative to vault root (e.g. "DailyNotes"). Empty for root.',
          },
        },
      },
      execute: (input) => {
        const path = (input.path as string) || "";
        const folder = path
          ? app.vault.getAbstractFileByPath(path)
          : app.vault.getRoot();

        if (!(folder instanceof TFolder)) {
          return Promise.resolve({ success: false, result: `Folder not found: ${path || "/"}` });
        }

        const entries = folder.children
          .map((child) => {
            const isFolder = child instanceof TFolder;
            return `${isFolder ? "[DIR] " : "      "}${child.name}`;
          })
          .sort();

        return Promise.resolve({
          success: true,
          result: `Contents of ${path || "/"}:\n${entries.join("\n")}`,
        });
      },
    },

    // --- Get Active Note ---
    {
      name: "get_active_note",
      description:
        "Get the currently open/active note in the editor. Returns the file path, content, and frontmatter.",
      input_schema: {
        type: "object",
        properties: {},
      },
      execute: async (input) => {
        void input;
        const file = app.workspace.getActiveFile();
        if (!file) {
          return { success: false, result: "No note is currently open" };
        }
        const content = await app.vault.read(file);
        const cache = app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter
          ? JSON.stringify(cache.frontmatter, null, 2)
          : "No frontmatter";

        return {
          success: true,
          result: truncateResult(`Path: ${file.path}\nFrontmatter: ${frontmatter}\n\nContent:\n${content}`),
        };
      },
    },

    // --- Get Backlinks ---
    {
      name: "get_backlinks",
      description:
        "Find all notes that link to a given note (backlinks / incoming links).",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the note to find backlinks for",
          },
        },
        required: ["path"],
      },
      execute: (input) => {
        const targetPath = input.path as string;
        const targetFile = app.vault.getAbstractFileByPath(targetPath);
        if (!targetFile) {
          return Promise.resolve({ success: false, result: `File not found: ${targetPath}` });
        }

        // Get the basename without extension for wikilink matching
        const baseName = targetPath.replace(/\.md$/, "").split("/").pop() || "";
        const allFiles = app.vault.getMarkdownFiles();
        const backlinks: string[] = [];

        for (const file of allFiles) {
          if (file.path === targetPath) continue;
          const cache = app.metadataCache.getFileCache(file);
          if (!cache?.links) continue;

          for (const link of cache.links) {
            const linkPath = link.link.split("#")[0].split("|")[0]; // strip anchors and aliases
            if (linkPath === baseName || linkPath === targetPath) {
              backlinks.push(`${file.path} (line text: "${link.original}")`);
              break;
            }
          }
        }

        if (backlinks.length === 0) {
          return Promise.resolve({ success: true, result: `No backlinks found for ${targetPath}` });
        }
        return Promise.resolve({
          success: true,
          result: `${String(backlinks.length)} backlinks to ${targetPath}:\n${backlinks.join("\n")}`,
        });
      },
    },

    // --- Get Tags ---
    {
      name: "get_tags",
      description:
        "List all tags used in the vault, or find all notes with a specific tag.",
      input_schema: {
        type: "object",
        properties: {
          tag: {
            type: "string",
            description:
              'Optional: a specific tag to search for (with or without #). If omitted, lists all tags.',
          },
        },
      },
      execute: (input) => {
        const searchTag = input.tag as string | undefined;

        if (searchTag) {
          // Find notes with this specific tag
          const normalizedTag = searchTag.startsWith("#") ? searchTag : `#${searchTag}`;
          const files = app.vault.getMarkdownFiles();
          const matches: string[] = [];

          for (const file of files) {
            const cache = app.metadataCache.getFileCache(file);
            const tags = [
              ...(cache?.tags?.map((t) => t.tag) || []),
              ...(cache?.frontmatter?.tags?.map((t: string) => `#${t}`) || []),
            ];
            if (tags.some((t) => t === normalizedTag || t.startsWith(normalizedTag + "/"))) {
              matches.push(file.path);
            }
          }

          return Promise.resolve({
            success: true,
            result: matches.length > 0
              ? `${String(matches.length)} notes with ${normalizedTag}:\n${matches.join("\n")}`
              : `No notes found with tag ${normalizedTag}`,
          });
        }

        // List all tags
        const tagCounts = new Map<string, number>();
        const files = app.vault.getMarkdownFiles();

        for (const file of files) {
          const cache = app.metadataCache.getFileCache(file);
          const tags = [
            ...(cache?.tags?.map((t) => t.tag) || []),
            ...(cache?.frontmatter?.tags?.map((t: string) => `#${t}`) || []),
          ];
          for (const tag of tags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }

        const sorted = [...tagCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([tag, count]) => `${tag} (${String(count)})`);

        return Promise.resolve({
          success: true,
          result: `${String(sorted.length)} tags in vault:\n${sorted.join("\n")}`,
        });
      },
    },

    // --- Get Frontmatter ---
    {
      name: "get_frontmatter",
      description: "Read the YAML frontmatter of a note as structured data.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the note",
          },
        },
        required: ["path"],
      },
      execute: (input) => {
        const path = input.path as string;
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return Promise.resolve({ success: false, result: `File not found: ${path}` });
        }
        const cache = app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) {
          return Promise.resolve({ success: true, result: `No frontmatter in ${path}` });
        }
        return Promise.resolve({
          success: true,
          result: JSON.stringify(cache.frontmatter, null, 2),
        });
      },
    },

    // --- Get Vault Structure ---
    {
      name: "get_vault_structure",
      description:
        "Get the full folder tree of the vault with note counts per folder. Useful for understanding vault organization.",
      input_schema: {
        type: "object",
        properties: {
          max_depth: {
            type: "number",
            description: "Maximum folder depth to show (default: 3)",
          },
        },
      },
      execute: (input) => {
        const maxDepth = (input.max_depth as number) || 3;
        const lines: string[] = [];

        function walkFolder(folder: TFolder, depth: number, prefix: string) {
          if (depth > maxDepth) return;

          const files = folder.children.filter((c) => c instanceof TFile);
          const folders = folder.children.filter(
            (c): c is TFolder => c instanceof TFolder
          );

          lines.push(
            `${prefix}${folder.name}/ (${String(files.length)} notes)`
          );

          folders.sort((a, b) => a.name.localeCompare(b.name));
          for (const sub of folders) {
            walkFolder(sub, depth + 1, prefix + "  ");
          }
        }

        walkFolder(app.vault.getRoot(), 0, "");
        return Promise.resolve({ success: true, result: lines.join("\n") });
      },
    },

    // --- Get Daily Note ---
    {
      name: "get_daily_note",
      description:
        'Get the daily note for a given date. Date format is "Month DD, YYYY" (e.g. "March 18, 2026"). Looks in the DailyNotes/ folder.',
      input_schema: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              'Date string in "Month DD, YYYY" format. Use "today" for today\'s note.',
          },
        },
        required: ["date"],
      },
      execute: async (input) => {
        let dateStr = input.date as string;
        if (dateStr.toLowerCase() === "today") {
          const now = new Date();
          const months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
          ];
          const day = String(now.getDate()).padStart(2, "0");
          dateStr = `${months[now.getMonth()]} ${day}, ${String(now.getFullYear())}`;
        }

        const path = `DailyNotes/${dateStr}.md`;
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { success: false, result: `Daily note not found: ${path}` };
        }
        const content = await app.vault.read(file);
        return { success: true, result: truncateResult(`Path: ${path}\n\n${content}`) };
      },
    },

    // --- Resolve Wikilinks ---
    {
      name: "resolve_wikilinks",
      description:
        "Resolve Obsidian [[wikilinks]] to actual file paths. Useful for following links between notes.",
      input_schema: {
        type: "object",
        properties: {
          link: {
            type: "string",
            description:
              'The wikilink text to resolve (e.g. "My Note" or "folder/My Note")',
          },
        },
        required: ["link"],
      },
      execute: (input) => {
        const linkText = input.link as string;
        // Try direct path first
        const directPath = linkText.endsWith(".md") ? linkText : `${linkText}.md`;
        const direct = app.vault.getAbstractFileByPath(directPath);
        if (direct) {
          return Promise.resolve({ success: true, result: `Resolved: ${direct.path}` });
        }

        // Search all files for a matching basename
        const files = app.vault.getMarkdownFiles();
        const matches = files.filter((f) => {
          const baseName = f.basename;
          return baseName === linkText || baseName.toLowerCase() === linkText.toLowerCase();
        });

        if (matches.length === 0) {
          return Promise.resolve({ success: false, result: `Could not resolve link: [[${linkText}]]` });
        }
        if (matches.length === 1) {
          return Promise.resolve({ success: true, result: `Resolved: ${matches[0].path}` });
        }
        return Promise.resolve({
          success: true,
          result: `Multiple matches for [[${linkText}]]:\n${matches.map((m) => m.path).join("\n")}`,
        });
      },
    },
  ];
}
