/** Built-in slash commands — a writer's dream toolkit */

export interface SlashCommand {
  name: string;
  description: string;
  /** System instruction prepended to the user's message */
  instruction: string;
  /** Whether this command requires text after the command */
  requiresArg: boolean;
  /** Placeholder text shown in autocomplete */
  argPlaceholder?: string;
  /** Category for grouping in UI */
  category: "write" | "edit" | "analyze" | "organize" | "research" | "vault";
  /** If true, uses the lightweight model (cheaper, faster) */
  useLightModel?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ===================================================================
  // WRITING & CREATION
  // ===================================================================
  {
    name: "/brainstorm",
    description: "Generate ideas on a topic with creative prompts",
    instruction:
      "You are a creative brainstorming partner. Generate a rich, diverse list of ideas on the given topic. " +
      "For each idea, give a brief 1-2 sentence description. Include unexpected angles and connections. " +
      "Organize ideas into categories if there are many. Aim for at least 10 ideas ranging from " +
      "conventional to creative to wildcard. Format as a numbered list.",
    requiresArg: true,
    argPlaceholder: "topic or question to brainstorm about",
    category: "write",
  },
  {
    name: "/wordsmith",
    description: "Polish prose — tighten sentences, improve rhythm, elevate diction",
    instruction:
      "You are a master wordsmith. Improve the following text by: " +
      "1) Tightening sentences — remove filler words, redundancies, and weak constructions. " +
      "2) Improving rhythm — vary sentence length, fix awkward cadences. " +
      "3) Elevating diction — replace vague or overused words with precise, vivid alternatives. " +
      "4) Strengthening verbs — prefer active voice and specific verbs over generic ones. " +
      "Preserve the author's voice and intent. Do NOT change the meaning. " +
      "Show the revised text, then briefly note what you changed and why.",
    requiresArg: false,
    category: "write",
  },
  {
    name: "/expand",
    description: "Expand a brief outline or notes into full prose",
    instruction:
      "Expand the following outline, notes, or brief text into polished, flowing prose. " +
      "Maintain the original structure but add transitions, context, supporting details, " +
      "and smooth connective tissue. Match the tone of the existing content. " +
      "If the content has bullet points, weave them into proper paragraphs. " +
      "Preserve all wikilinks, frontmatter, and formatting.",
    requiresArg: false,
    category: "write",
  },
  {
    name: "/draft",
    description: "Write a first draft from a prompt or brief",
    instruction:
      "Write a complete first draft based on the user's brief. " +
      "Focus on getting ideas down clearly rather than perfection. " +
      "Use appropriate structure (headings, paragraphs, lists as needed). " +
      "If writing for Obsidian, use markdown formatting and [[wikilinks]] where relevant. " +
      "Aim for substance — don't pad with filler. End with a brief note on areas to develop further.",
    requiresArg: true,
    argPlaceholder: "what to draft (e.g., 'blog post about...', 'letter to...', 'essay on...')",
    category: "write",
  },
  {
    name: "/headline",
    description: "Generate title and subtitle options",
    instruction:
      "Generate 10 title options for the active note or given topic. " +
      "Include a mix of styles: straightforward, provocative, question-based, " +
      "and creative. For each title, suggest an optional subtitle. " +
      "Format: numbered list with title in bold and subtitle in italics.",
    requiresArg: false,
    category: "write",
  },
  {
    name: "/metaphor",
    description: "Suggest metaphors, analogies, and illustrations",
    instruction:
      "Analyze the active note's key concepts and suggest vivid metaphors, " +
      "analogies, and illustrations that could strengthen the writing. " +
      "For each suggestion, explain: the metaphor, where it could be used, " +
      "and why it works. Include both familiar and unexpected comparisons. " +
      "Aim for at least 5 suggestions.",
    requiresArg: false,
    category: "write",
  },
  {
    name: "/dialogue",
    description: "Generate or improve dialogue",
    instruction:
      "Help with dialogue. If the active note contains dialogue, improve it — " +
      "make it more natural, distinct per character, and purposeful. " +
      "If given a scenario, generate realistic dialogue for it. " +
      "Each character should have a distinct voice. Avoid info-dumping through dialogue.",
    requiresArg: false,
    category: "write",
  },
  {
    name: "/hook",
    description: "Write compelling opening lines or paragraphs",
    instruction:
      "Generate 5 compelling opening hooks for the given topic or active note. " +
      "Include different styles: anecdote, surprising fact, provocative question, " +
      "bold statement, and scene-setting. Each hook should be 1-3 sentences " +
      "that make the reader want to continue.",
    requiresArg: false,
    category: "write",
  },
  {
    name: "/conclude",
    description: "Write a strong conclusion or closing",
    instruction:
      "Write a strong conclusion for the active note. Read the full note first. " +
      "The conclusion should: revisit the main thesis without repeating it, " +
      "synthesize key points into a closing insight, and leave the reader " +
      "with something to think about. Offer 2-3 versions with different tones " +
      "(reflective, call-to-action, forward-looking).",
    requiresArg: false,
    category: "write",
  },

  // ===================================================================
  // EDITING & REVISION
  // ===================================================================
  {
    name: "/summarize",
    description: "Summarize the active note or specified content",
    instruction:
      "Summarize the following content concisely. Use bullet points for key ideas. " +
      "Preserve important details, names, and dates. If the content is a note, " +
      "maintain any wikilinks [[like this]] in the summary.",
    requiresArg: false,
    category: "edit",
  },
  {
    name: "/outline",
    description: "Generate a structured outline from the active note",
    instruction:
      "Create a clean, hierarchical outline from the following content. " +
      "Use markdown headings (##, ###) and bullet points. Identify the main " +
      "themes and organize sub-points logically beneath them.",
    requiresArg: false,
    category: "edit",
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
    category: "edit",
  },
  {
    name: "/fixup",
    description: "Fix grammar, spelling, and formatting",
    instruction:
      "Review the active note for grammar, spelling, punctuation, and markdown formatting issues. " +
      "Fix all issues found using the edit_note tool. Preserve the author's voice and meaning. " +
      "Do not change technical terms, proper nouns, or intentional stylistic choices. " +
      "Report what you changed.",
    requiresArg: false,
    category: "edit",
  },
  {
    name: "/shorten",
    description: "Cut the word count by a target percentage",
    instruction:
      "Shorten the active note's content by approximately the target percentage (default: 30%). " +
      "Cut ruthlessly but preserve meaning. Remove: redundancies, qualifiers, filler phrases, " +
      "and passages that don't earn their space. Tighten sentences. " +
      "Show the shortened version and report the word count before and after.",
    requiresArg: false,
    argPlaceholder: "percentage to cut (e.g., '50%', '20%')",
    category: "edit",
  },
  {
    name: "/tone",
    description: "Analyze or change the tone of writing",
    instruction:
      "If no target tone is specified, analyze the current tone of the active note: " +
      "formality level, emotional register, pace, and voice. " +
      "If a target tone is given, rewrite the content to match that tone " +
      "while preserving the core message. Show before/after for key passages.",
    requiresArg: false,
    argPlaceholder: "target tone (e.g., 'warmer', 'more formal', 'conversational')",
    category: "edit",
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
    category: "edit",
  },

  // ===================================================================
  // ANALYSIS & CRITIQUE
  // ===================================================================
  {
    name: "/critique",
    description: "Get constructive feedback on your writing",
    instruction:
      "Provide a thorough, constructive critique of the active note's writing. Cover: " +
      "1) Structure — is the argument/narrative well-organized? " +
      "2) Clarity — are ideas expressed clearly? Where is it confusing? " +
      "3) Evidence — are claims supported? What needs backing up? " +
      "4) Engagement — does it hold attention? Where does it lag? " +
      "5) Voice — is the author's voice consistent and distinctive? " +
      "Be specific: quote passages and suggest concrete improvements. " +
      "End with the top 3 things to fix first.",
    requiresArg: false,
    category: "analyze",
  },
  {
    name: "/counterargument",
    description: "Generate counterarguments to strengthen your position",
    instruction:
      "Read the active note and identify the main arguments or claims. " +
      "For each, generate the strongest possible counterargument. " +
      "Then suggest how to address each counterargument — either by refuting it, " +
      "acknowledging it, or integrating it. This helps strengthen the original argument.",
    requiresArg: false,
    category: "analyze",
  },
  {
    name: "/audience",
    description: "Analyze or adapt writing for a specific audience",
    instruction:
      "If an audience is specified, rewrite the active note to better suit that audience " +
      "(adjust vocabulary, examples, depth, tone). " +
      "If no audience is specified, analyze who the current writing seems targeted at " +
      "and suggest what audiences it could be adapted for.",
    requiresArg: false,
    argPlaceholder: "target audience (e.g., 'beginners', 'executives', 'teenagers')",
    category: "analyze",
  },
  {
    name: "/readability",
    description: "Analyze reading level and suggest simplifications",
    instruction:
      "Analyze the active note's readability. Report: " +
      "- Approximate reading level (grade level) " +
      "- Average sentence length " +
      "- Complex word percentage " +
      "- Passive voice usage " +
      "- Estimated reading time " +
      "Then suggest specific improvements to make it more readable. " +
      "Flag the 5 most complex sentences and offer simpler alternatives.",
    requiresArg: false,
    category: "analyze",
    useLightModel: true,
  },

  // ===================================================================
  // RESEARCH & DISCOVERY
  // ===================================================================
  {
    name: "/ask",
    description: "Ask a question about the vault without modifying anything",
    instruction:
      "Answer the user's question by reading and analyzing notes in the vault. " +
      "Do NOT modify any files. Use the search and read tools to find relevant information. " +
      "Cite specific notes with [[wikilinks]] when referencing information.",
    requiresArg: true,
    argPlaceholder: "your question about the vault",
    category: "research",
  },
  {
    name: "/find-hyperlinks",
    description: "Scan vault for topics that should be linked (uses light model)",
    instruction:
      "Scan the active note and identify every concept, name, term, and topic that might have " +
      "a corresponding note elsewhere in the vault. For each candidate: " +
      "1) Search the vault using search_vault and get_tags tools " +
      "2) If a matching note exists, suggest adding a [[wikilink]] " +
      "3) If no note exists but the topic is important, suggest creating one " +
      "Be thorough — check every proper noun, technical term, and key concept. " +
      "Format as a table: | Term | Existing Note? | Suggested Action |",
    requiresArg: false,
    category: "research",
    useLightModel: true,
  },
  {
    name: "/research",
    description: "Compile research from across the vault on a topic",
    instruction:
      "Search the entire vault for information related to the given topic. " +
      "Use search_vault, get_tags, and get_backlinks to find relevant notes. " +
      "Read the most relevant notes and compile a research summary with: " +
      "- Key findings organized by theme " +
      "- Source notes cited as [[wikilinks]] " +
      "- Gaps in coverage (what's missing from the vault) " +
      "- Suggested next steps for research",
    requiresArg: true,
    argPlaceholder: "topic to research across the vault",
    category: "research",
  },
  {
    name: "/connect",
    description: "Find hidden connections between notes",
    instruction:
      "Analyze the active note and search the vault for unexpected connections — " +
      "notes that share themes, concepts, or ideas but aren't currently linked. " +
      "Look beyond obvious surface-level connections to find deeper thematic relationships. " +
      "For each connection found, explain the relationship and suggest how to link them. " +
      "Use search_vault and get_tags extensively.",
    requiresArg: false,
    category: "research",
    useLightModel: true,
  },
  {
    name: "/bibliography",
    description: "Generate a bibliography from vault references",
    instruction:
      "Search the vault for references, citations, book mentions, and sources related to " +
      "the active note or given topic. Compile them into a formatted bibliography. " +
      "Include: title, author, and the vault note where it was referenced. " +
      "Use [[wikilinks]] to cite the source notes.",
    requiresArg: false,
    category: "research",
  },

  // ===================================================================
  // ORGANIZATION & VAULT MANAGEMENT
  // ===================================================================
  {
    name: "/tags",
    description: "Analyze and suggest tags for the active note",
    instruction:
      "Analyze the active note's content and suggest appropriate tags. " +
      "Look at existing tags in the vault for consistency. " +
      "Return suggestions as a list: #tag1, #tag2, etc. " +
      "Explain briefly why each tag is relevant.",
    requiresArg: false,
    category: "organize",
    useLightModel: true,
  },
  {
    name: "/links",
    description: "Find and suggest wikilinks for the active note",
    instruction:
      "Analyze the active note and find other notes in the vault that are related. " +
      "Suggest [[wikilinks]] that could be added to connect this note to related content. " +
      "For each suggestion, explain the connection and where in the note the link could go.",
    requiresArg: false,
    category: "organize",
    useLightModel: true,
  },
  {
    name: "/daily",
    description: "Create or update today's daily note",
    instruction:
      "Work with today's daily note. If it doesn't exist, create it following the vault's " +
      'daily note format (filename: "Month DD, YYYY.md" in DailyNotes/ folder, ' +
      'with creation_date frontmatter). If it exists, help the user add content to it.',
    requiresArg: false,
    category: "vault",
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
    category: "vault",
  },
  {
    name: "/merge",
    description: "Merge multiple notes into one cohesive document",
    instruction:
      "Merge the specified notes (or notes tagged/linked from the active note) into a single " +
      "cohesive document. Remove redundancies, create smooth transitions between sections, " +
      "and organize the content logically. Preserve all unique information from each source. " +
      "List the source notes as references at the end.",
    requiresArg: true,
    argPlaceholder: "note names to merge (e.g., 'Note1, Note2, Note3')",
    category: "vault",
  },
  {
    name: "/toc",
    description: "Generate a table of contents for the active note",
    instruction:
      "Generate a markdown table of contents for the active note based on its headings. " +
      "Use proper markdown link format: - [Heading](#heading). " +
      "Include all heading levels (##, ###, ####). " +
      "Insert it at the top of the note after the frontmatter using the edit_note tool.",
    requiresArg: false,
    category: "organize",
    useLightModel: true,
  },
  {
    name: "/frontmatter",
    description: "Generate or clean up YAML frontmatter",
    instruction:
      "Analyze the active note and generate appropriate YAML frontmatter. " +
      "Include: title, tags, created date, and any other relevant fields. " +
      "If frontmatter already exists, clean it up and suggest additions. " +
      "Use existing vault conventions for field names and tag formats.",
    requiresArg: false,
    category: "organize",
    useLightModel: true,
  },
  {
    name: "/audit",
    description: "Audit vault health — orphaned notes, broken links, empty notes",
    instruction:
      "Perform a vault health audit. Check for: " +
      "1) Orphaned notes (no backlinks pointing to them) " +
      "2) Notes with no tags or frontmatter " +
      "3) Very short notes that might be stubs " +
      "4) Duplicate or near-duplicate note names " +
      "Use list_files, get_backlinks, get_tags, and get_frontmatter tools. " +
      "Report findings organized by severity.",
    requiresArg: false,
    category: "vault",
    useLightModel: true,
  },
];

/** Get commands by category */
export function getCommandsByCategory(): Record<string, SlashCommand[]> {
  const categories: Record<string, SlashCommand[]> = {};
  for (const cmd of SLASH_COMMANDS) {
    if (!categories[cmd.category]) categories[cmd.category] = [];
    categories[cmd.category].push(cmd);
  }
  return categories;
}

/** Category display names */
export const CATEGORY_LABELS: Record<string, string> = {
  write: "Writing & Creation",
  edit: "Editing & Revision",
  analyze: "Analysis & Critique",
  research: "Research & Discovery",
  organize: "Organization",
  vault: "Vault Management",
};

/** Parse a slash command from user input */
export function parseSlashCommand(
  input: string
): { command: SlashCommand; userText: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  for (const cmd of SLASH_COMMANDS) {
    if (trimmed === cmd.name || trimmed.startsWith(cmd.name + " ")) {
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
