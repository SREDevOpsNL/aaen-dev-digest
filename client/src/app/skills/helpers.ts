import type { SkillSummary } from "@devdigest/shared";

export function filterSkills(skills: SkillSummary[], query: string): SkillSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return skills;
  return skills.filter((skill) =>
    [skill.name, skill.description, skill.type].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}

export function deriveSkillName(body: string, filename?: string): string {
  const heading = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#\s+/.test(line));
  if (heading) return heading.replace(/^#\s+/, "").trim();
  if (filename) return filename.replace(/\.(md|markdown|txt)$/i, "").trim();
  return "";
}

export function approximateTokens(body: string): number {
  return Math.ceil(body.length / 4);
}

export function isSupportedSkillFileName(filename: string): boolean {
  return /\.(md|markdown|txt)$/i.test(filename);
}

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Above this many LCS cells the changed middle is shown as one removed block and one added block. */
export const LINE_DIFF_MAX_CELLS = 2_000_000;

/**
 * Line diff from `before` to `after` (longest common subsequence). Common
 * leading and trailing lines are matched first, so a typical edit only runs
 * the quadratic step on the changed middle; a middle too large for
 * LINE_DIFF_MAX_CELLS falls back to "all removed, then all added".
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: "same", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > LINE_DIFF_MAX_CELLS) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ kind: "del", text })),
      ...midB.map((text): DiffLine => ({ kind: "add", text })),
      ...tail,
    ];
  }

  // lcs[i][j] = length of the LCS of midA[i:] and midB[j:].
  const cols = midB.length + 1;
  const lcs = new Uint32Array((midA.length + 1) * cols);
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i * cols + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * cols + j + 1]! + 1
          : Math.max(lcs[(i + 1) * cols + j]!, lcs[i * cols + j + 1]!);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: "same", text: midA[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * cols + j]! >= lcs[i * cols + j + 1]!) {
      middle.push({ kind: "del", text: midA[i++]! });
    } else {
      middle.push({ kind: "add", text: midB[j++]! });
    }
  }
  while (i < midA.length) middle.push({ kind: "del", text: midA[i++]! });
  while (j < midB.length) middle.push({ kind: "add", text: midB[j++]! });
  return [...head, ...middle, ...tail];
}
