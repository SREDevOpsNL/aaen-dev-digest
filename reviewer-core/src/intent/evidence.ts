import type { UnifiedDiff } from '@devdigest/shared';

/**
 * Bounded, two-tier evidence for the intent classifier (pure; no I/O).
 *
 * Tier 1 — manifest: every changed file with its +/− counts and its hunk headers.
 * Tier 2 — excerpts: actual changed lines of the highest-churn files, each line
 * prefixed with its line number so the model can cite it.
 *
 * Both tiers are budgeted and every omission is declared. `sampled` records the
 * exact old/new line numbers of every excerpt line that was shown; citation
 * validation accepts only those lines.
 */

export interface IntentEvidenceLimits {
  /** Tier 1: max file rows, hunk headers per file, total characters. */
  manifestRows: number;
  headersPerFile: number;
  manifestChars: number;
  /** Tier 2: total characters, per-file characters and lines, lines per hunk. */
  excerptChars: number;
  fileExcerptChars: number;
  fileExcerptLines: number;
  hunkLines: number;
}

/** Defaults are evaluation candidates (D1), not a confirmed optimum. */
export const DEFAULT_INTENT_EVIDENCE_LIMITS: IntentEvidenceLimits = {
  manifestRows: 200,
  headersPerFile: 40,
  manifestChars: 8_000,
  excerptChars: 8_000,
  fileExcerptChars: 2_000,
  fileExcerptLines: 60,
  // 40, not 20: at 20 a single 26-line hunk lost its last lines — in the L01
  // demo exactly the callback POST and the key exfiltration.
  hunkLines: 40,
};

export const MANIFEST_INCOMPLETE_NOTE =
  'Note: this file list may be incomplete (deleted, binary or rename-only changes may be absent).';
export const NO_HUNKS_LABEL = 'no textual hunks in reviewed diff (reason not determined)';

/** A file the PR reports (e.g. from pr_files) that has no parsed hunks in the diff. */
export interface ExtraFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface SampledLines {
  new: Set<number>;
  old: Set<number>;
}

export interface IntentEvidence {
  manifest: string;
  excerpts: string;
  sampled: Map<string, SampledLines>;
  stats: { files_listed: number; files_excerpted: number; truncated: boolean };
}

interface ParsedLine {
  kind: '+' | '-' | ' ';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

interface ParsedHunk {
  header: string;
  lines: ParsedLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Split `diff.raw` into per-file hunks with line text and both line numbers. */
function parseFileHunks(raw: string): Map<string, ParsedHunk[]> {
  const byFile = new Map<string, ParsedHunk[]>();
  let path: string | null = null;
  let hunks: ParsedHunk[] = [];
  let hunk: ParsedHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const flush = () => {
    if (hunk) hunks.push(hunk);
    hunk = null;
    if (path) byFile.set(path, [...(byFile.get(path) ?? []), ...hunks]);
    hunks = [];
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git')) {
      flush();
      path = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/^b\//, '').trim();
      path = p === '/dev/null' ? null : p;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const header = line.match(HUNK_HEADER);
    if (header) {
      if (hunk) hunks.push(hunk);
      hunk = { header: line.slice(0, line.indexOf('@@', 2) + 2), lines: [] };
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      continue;
    }
    if (!hunk || line.startsWith('\\')) continue;
    if (line.startsWith('+')) {
      hunk.lines.push({ kind: '+', text: line.slice(1), oldNo: null, newNo: newNo++ });
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: '-', text: line.slice(1), oldNo: oldNo++, newNo: null });
    } else {
      hunk.lines.push({ kind: ' ', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  flush();
  return byFile;
}

/** `L12 + text` (head line), `O9 - text` (base line), `L13   text` (context). */
function renderLine(line: ParsedLine): string {
  if (line.kind === '+') return `L${line.newNo} + ${line.text}`;
  if (line.kind === '-') return `O${line.oldNo} - ${line.text}`;
  return `L${line.newNo}   ${line.text}`;
}

export function buildIntentEvidence(
  diff: UnifiedDiff,
  opts: { extraFiles?: ExtraFile[]; limits?: Partial<IntentEvidenceLimits> } = {},
): IntentEvidence {
  const limits = { ...DEFAULT_INTENT_EVIDENCE_LIMITS, ...opts.limits };
  const hunksByFile = parseFileHunks(diff.raw);
  const files = [...diff.files].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path),
  );
  const known = new Set(files.map((f) => f.path));
  const extra = (opts.extraFiles ?? []).filter((f) => !known.has(f.path));
  let truncated = false;

  // ---- Tier 1: manifest -----------------------------------------------------
  const manifestLines: string[] = [];
  let manifestChars = 0;
  let listed = 0;
  const rows: { path: string; additions: number; deletions: number; body: string }[] = [
    ...files.map((f) => {
      const headers = (hunksByFile.get(f.path) ?? []).map((h) => h.header);
      const shown = headers.slice(0, limits.headersPerFile).map((h) => `  ${h}`);
      if (headers.length > shown.length) {
        shown.push(`  … +${headers.length - shown.length} more hunks not listed`);
        truncated = true;
      }
      return {
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        body: [`${f.path}  +${f.additions} -${f.deletions}  hunks: ${headers.length}`, ...shown].join('\n'),
      };
    }),
    ...extra.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      body: `${f.path}  +${f.additions} -${f.deletions}  ${NO_HUNKS_LABEL}`,
    })),
  ];
  for (const [index, row] of rows.entries()) {
    if (listed >= limits.manifestRows || manifestChars + row.body.length > limits.manifestChars) {
      const rest = rows.slice(index);
      const adds = rest.reduce((n, r) => n + r.additions, 0);
      const dels = rest.reduce((n, r) => n + r.deletions, 0);
      manifestLines.push(`… +${rest.length} more files (+${adds} -${dels}) not listed`);
      truncated = true;
      break;
    }
    manifestLines.push(row.body);
    manifestChars += row.body.length + 1;
    listed += 1;
  }
  manifestLines.push(MANIFEST_INCOMPLETE_NOTE);

  // ---- Tier 2: excerpts -----------------------------------------------------
  const sampled = new Map<string, SampledLines>();
  const blocks: string[] = [];
  const omitted: string[] = [];
  let excerptChars = 0;
  for (const file of files) {
    const hunks = hunksByFile.get(file.path) ?? [];
    if (hunks.length === 0) continue;
    if (excerptChars >= limits.excerptChars) {
      omitted.push(file.path);
      continue;
    }
    const fileBudget = Math.min(limits.fileExcerptChars, limits.excerptChars - excerptChars);
    const lines: string[] = [`### ${file.path}`];
    let chars = lines[0]!.length;
    let bodyLines = 0;
    const seen: SampledLines = { new: new Set(), old: new Set() };
    let fileCut = false;
    for (const [h, hunk] of hunks.entries()) {
      if (bodyLines >= limits.fileExcerptLines || chars + hunk.header.length > fileBudget) {
        lines.push(`… [file truncated: ${hunks.length - h} more hunks]`);
        fileCut = true;
        break;
      }
      lines.push(hunk.header);
      chars += hunk.header.length + 1;
      let shownInHunk = 0;
      for (const line of hunk.lines) {
        const rendered = renderLine(line);
        if (
          shownInHunk >= limits.hunkLines ||
          bodyLines >= limits.fileExcerptLines ||
          chars + rendered.length > fileBudget
        ) {
          break;
        }
        lines.push(rendered);
        chars += rendered.length + 1;
        shownInHunk += 1;
        bodyLines += 1;
        if (line.newNo !== null) seen.new.add(line.newNo);
        if (line.oldNo !== null) seen.old.add(line.oldNo);
      }
      if (shownInHunk < hunk.lines.length) {
        lines.push(`… [hunk truncated: ${hunk.lines.length - shownInHunk} lines]`);
        truncated = true;
      }
    }
    if (fileCut) truncated = true;
    if (seen.new.size + seen.old.size === 0) {
      omitted.push(file.path);
      continue;
    }
    sampled.set(file.path, seen);
    blocks.push(lines.join('\n'));
    excerptChars += chars;
  }
  if (omitted.length > 0) {
    blocks.push(`Files changed but not excerpted (budget): ${omitted.join(', ')}`);
    truncated = true;
  }

  return {
    manifest: manifestLines.join('\n'),
    excerpts: blocks.length > 0 ? blocks.join('\n\n') : '(no textual hunks to excerpt)',
    sampled,
    stats: { files_listed: listed, files_excerpted: sampled.size, truncated },
  };
}
