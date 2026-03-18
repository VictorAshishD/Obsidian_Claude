/** Built-in slash commands that prepend specialized instructions to user messages */

export interface SlashCommand {
  name: string;
  description: string;
  /** System instruction prepended to the user's message */
  instruction: string;
  /** Whether this command requires text after the command (e.g. /translate Spanish) */
  requiresArg: boolean;
  /** Placeholder text shown in autocomplete */
  argPlaceholder?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/summarize",
    description: "Summarize the active note or specified content",
    instruction:
      "Summarize the following content concisely. Use bullet points for key ideas. " +
      "Preserve important details, names, and dates. If the content is a note, " +
      "maintain any wikilinks [[like this]] in the summary.",
    requiresArg: false,
  },
  {
    name: "/outline",
    description: "Generate a structured outline from the active note",
    instruction:
      "Create a clean, hierarchical outline from the following content. " +
      "Use markdown headings (##, ###) and bullet points. Identify the main " +
      "themes and organize sub-points logically beneath them.",
    requiresArg: false,
  },
  {
    name: "/rewrite",
    description: "Rewrite content with a specified style or improvement",
    instruction:
      "Rewrite the following content according to the user's instructions. " +
      "Preserve the core meaning and any wiki-links, frontmatter, or markdown formatting. " +
      "Only change the prose style, clarity, or structure as requested.",
    requiresArg: true,
    argPlaceholder: "style (e.g., 'more concise', 'academic tone', 'simpler language')",
  },
  {
    name: "/translate",
    description: "Translate content to a specified language",
    instruction:
      "Translate the following content to the specified language. " +
      "Preserve all markdown formatting, frontmatter, wikilinks, and code blocks. " +
      "Only translate the natural language text.",
    requiresArg: true,
    argPlaceholder: "target language (e.g., Spanish, French, German)",
  },
  {
    name: "/ask",
    description: "Ask a question about the vault without modifying anything",
    instruction:
      "Answer the user's question by reading and analyzing notes in the vault. " +
      "Do NOT modify any files. Use the search and read tools to find relevant information. " +
      "Cite specific notes with [[wikilinks]] when referencing information.",
    requiresArg: true,
    argPlaceholder: "your question about the vault",
  },
  {
    name: "/tags",
    description: "Analyze and suggest tags for the active note",
    instruction:
      "Analyze the active note's content and suggest appropriate tags. " +
      "Look at existing tags in the vault for consistency. " +
      "Return suggestions as a list: #tag1, #tag2, etc. " +
      "Explain briefly why each tag is relevant.",
    requiresArg: false,
  },
  {
    name: "/links",
    description: "Find and suggest wikilinks for the active note",
    instruction:
      "Analyze the active note and find other notes in the vault that are related. " +
      "Suggest [[wikilinks]] that could be added to connect this note to related content. " +
      "For each suggestion, explain the connection and where in the note the link could go.",
    requiresArg: false,
  },
  {
    name: "/daily",
    description: "Create or update today's daily note",
    instruction:
      "Work with today's daily note. If it doesn't exist, create it following the vault's " +
      'daily note format (filename: "Month DD, YYYY.md" in DailyNotes/ folder, ' +
      'with creation_date frontmatter). If it exists, help the user add content to it.',
    requiresArg: false,
  },
  {
    name: "/fixup",
    description: "Fix grammar, spelling, and formatting in the active note",
    instruction:
      "Review the active note for grammar, spelling, punctuation, and markdown formatting issues. " +
      "Fix all issues found using the edit_note tool. Preserve the author's voice and meaning. " +
      "Do not change technical terms, proper nouns, or intentional stylistic choices. " +
      "Report what you changed.",
    requiresArg: false,
  },
  {
    name: "/extract",
    description: "Extract a section into a new note with a wikilink",
    instruction:
      "Extract the specified section from the active note into a new separate note. " +
      "Replace the extracted content with a [[wikilink]] to the new note. " +
      "Preserve all formatting in the extracted content. " +
      "Ask the user which section to extract if not specified.",
    requiresArg: true,
    argPlaceholder: "section heading or description of content to extract",
  },
];

/** Parse a slash command from user input. Returns the command and remaining text, or null. */
export function parseSlashCommand(
  input: string
): { command: SlashCommand; userText: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  for (const cmd of SLASH_COMMANDS) {
    if (
      trimmed === cmd.name ||
      trimmed.startsWith(cmd.name + " ")
    ) {
      const userText = trimmed.slice(cmd.name.length).trim();
      return { command: cmd, userText };
    }
  }

  return null;
}

/** Build the final prompt with slash command instruction prepended */
export function buildSlashCommandPrompt(
  command: SlashCommand,
  userText: string,
  activeNotePath?: string
): string {
  const parts: string[] = [];

  parts.push(`[Instruction: ${command.instruction}]`);

  if (activeNotePath) {
    parts.push(`[Active note: ${activeNotePath} — use get_active_note tool to read it]`);
  }

  if (userText) {
    parts.push(`\nUser input: ${userText}`);
  } else if (!command.requiresArg) {
    parts.push("\nApply this to the currently active note.");
  }

  return parts.join("\n");
}
