/**
 * Inline diff view component for reviewing file edits.
 * Shows word-level diffs with accept/reject buttons.
 */

export interface DiffChange {
  type: "equal" | "add" | "remove";
  value: string;
}

export interface PendingEdit {
  id: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  description: string;
  status: "pending" | "accepted" | "rejected";
}

/** Simple line-level diff implementation */
export function computeLineDiff(oldText: string, newText: string): DiffChange[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const changes: DiffChange[] = [];

  // Simple LCS-based line diff
  const lcs = computeLCS(oldLines, newLines);
  let oldIdx = 0;
  let newIdx = 0;

  for (const [oi, ni] of lcs) {
    // Lines removed (in old but not in LCS yet)
    while (oldIdx < oi) {
      changes.push({ type: "remove", value: oldLines[oldIdx] });
      oldIdx++;
    }
    // Lines added (in new but not in LCS yet)
    while (newIdx < ni) {
      changes.push({ type: "add", value: newLines[newIdx] });
      newIdx++;
    }
    // Equal line
    changes.push({ type: "equal", value: oldLines[oi] });
    oldIdx = oi + 1;
    newIdx = ni + 1;
  }

  // Remaining removals
  while (oldIdx < oldLines.length) {
    changes.push({ type: "remove", value: oldLines[oldIdx] });
    oldIdx++;
  }
  // Remaining additions
  while (newIdx < newLines.length) {
    changes.push({ type: "add", value: newLines[newIdx] });
    newIdx++;
  }

  return changes;
}

/** Compute longest common subsequence indices */
function computeLCS(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the actual pairs
  const result: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/** Render a diff card into a container element */
export function renderDiffCard(
  container: HTMLElement,
  edit: PendingEdit,
  onAccept: (edit: PendingEdit) => void,
  onReject: (edit: PendingEdit) => void
): HTMLElement {
  const card = container.createDiv("vault-claude-diff-card");
  card.id = `diff-${edit.id}`;

  // Header
  const header = card.createDiv("vault-claude-diff-header");
  header.createSpan({ text: "📝 ", cls: "vault-claude-diff-icon" });
  header.createSpan({ text: edit.filePath, cls: "vault-claude-diff-path" });
  if (edit.description) {
    header.createSpan({ text: ` — ${edit.description}`, cls: "vault-claude-diff-desc" });
  }

  // Diff content
  const diffContent = card.createDiv("vault-claude-diff-content");
  const changes = computeLineDiff(edit.oldContent, edit.newContent);

  // Only show changed regions with a few lines of context
  let lineNum = 0;
  let lastShownLine = -5;

  for (const change of changes) {
    lineNum++;
    if (change.type === "equal") {
      // Show context lines near changes
      const isNearChange = changes.some(
        (c, idx) =>
          c.type !== "equal" &&
          Math.abs(
            changes.slice(0, idx).filter((x) => x.type !== "add").length - lineNum
          ) <= 2
      );
      if (!isNearChange) continue;
    }

    if (lineNum - lastShownLine > 3 && change.type === "equal") {
      diffContent.createDiv({ cls: "vault-claude-diff-separator", text: "···" });
    }
    lastShownLine = lineNum;

    const lineEl = diffContent.createDiv({
      cls: `vault-claude-diff-line vault-claude-diff-${change.type}`,
    });

    const prefix =
      change.type === "add" ? "+ " : change.type === "remove" ? "- " : "  ";
    lineEl.createSpan({ cls: "vault-claude-diff-prefix", text: prefix });
    lineEl.createSpan({ cls: "vault-claude-diff-text", text: change.value || " " });
  }

  // Stats
  const adds = changes.filter((c) => c.type === "add").length;
  const removes = changes.filter((c) => c.type === "remove").length;
  const statsEl = card.createDiv("vault-claude-diff-stats");
  if (adds > 0) statsEl.createSpan({ text: `+${adds}`, cls: "vault-claude-diff-adds" });
  if (removes > 0) statsEl.createSpan({ text: ` -${removes}`, cls: "vault-claude-diff-removes" });

  // Action buttons
  if (edit.status === "pending") {
    const actions = card.createDiv("vault-claude-diff-actions");

    const acceptBtn = actions.createEl("button", {
      cls: "vault-claude-diff-accept",
      text: "Accept",
    });
    acceptBtn.addEventListener("click", () => {
      edit.status = "accepted";
      updateDiffCardStatus(card, "accepted");
      onAccept(edit);
    });

    const rejectBtn = actions.createEl("button", {
      cls: "vault-claude-diff-reject",
      text: "Reject",
    });
    rejectBtn.addEventListener("click", () => {
      edit.status = "rejected";
      updateDiffCardStatus(card, "rejected");
      onReject(edit);
    });
  } else {
    updateDiffCardStatus(card, edit.status);
  }

  return card;
}

function updateDiffCardStatus(
  card: HTMLElement,
  status: "accepted" | "rejected"
): void {
  card.classList.add(`vault-claude-diff-${status}`);

  const actions = card.querySelector(".vault-claude-diff-actions");
  if (actions) actions.remove();

  const badge = card.createDiv("vault-claude-diff-badge");
  badge.setText(status === "accepted" ? "Accepted" : "Rejected");
  badge.classList.add(
    status === "accepted" ? "vault-claude-diff-badge-accepted" : "vault-claude-diff-badge-rejected"
  );
}
