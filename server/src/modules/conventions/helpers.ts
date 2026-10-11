import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionSkillDraft,
} from '@devdigest/shared';
import type { ConventionRow } from './repository.js';
import {
  MAX_FILE_CHARS,
  MAX_FILE_LINES,
  MAX_SNIPPET_LINES,
  MIN_SNIPPET_CHARS,
} from './constants.js';

export interface SampledFile {
  path: string;
  text: string;
  lines: string[];
  truncated: boolean;
}

export function toSampledFile(path: string, raw: string): SampledFile {
  const byChars = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
  const allLines = byChars.split('\n');
  const lines = allLines.slice(0, MAX_FILE_LINES);
  return {
    path,
    text: lines.join('\n'),
    lines,
    truncated: lines.length < allLines.length || byChars.length < raw.length,
  };
}

export function renderSample(file: SampledFile): string {
  const body = file.lines.map((line, index) => `${index + 1}\t${line}`).join('\n');
  return `--- FILE: ${file.path} ---\n${body}${file.truncated ? '\n… (truncated)' : ''}`;
}

export function renderSamples(files: SampledFile[], maxChars: number): string {
  const output: string[] = [];
  let used = 0;
  for (const file of files) {
    const block = renderSample(file);
    if (used + block.length > maxChars) break;
    output.push(block);
    used += block.length + 2;
  }
  return output.join('\n\n');
}

export interface RawCandidate {
  category: string;
  rule: string;
  rationale?: string | null;
  evidence_path: string;
  evidence_line?: number | null;
  evidence_snippet: string;
  confidence: number;
}

export interface VerifiedCandidate {
  category: ConventionCategory;
  rule: string;
  rationale: string | null;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
}

export type DropReason = 'unknown_file' | 'snippet_too_short' | 'snippet_not_found' | 'empty_rule';
export type VerifyResult =
  | { ok: true; candidate: VerifiedCandidate }
  | { ok: false; reason: DropReason };

const CATEGORIES: readonly ConventionCategory[] = [
  'naming', 'structure', 'errors', 'testing', 'imports', 'typing', 'api', 'general',
];

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function resolveFile(
  files: Map<string, SampledFile>,
  cited: string,
): SampledFile | undefined {
  if (!cited) return undefined;
  const clean = cited.trim().replace(/^\.?\//, '').split(':')[0]!;
  const exact = files.get(clean);
  if (exact) return exact;
  const matches = [...files.values()].filter(
    (file) => file.path === clean || file.path.endsWith(`/${clean}`),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function findLine(lines: string[], head: string, claimed: number | null): number {
  const needle = normalize(head);
  const hits: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = normalize(lines[index]!);
    if (line && (line === needle || line.includes(needle))) hits.push(index);
  }
  if (hits.length === 0) return -1;
  if (claimed == null) return hits[0]!;
  const target = claimed - 1;
  return hits.reduce((best, index) =>
    Math.abs(index - target) < Math.abs(best - target) ? index : best,
  );
}

function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const minimum = indents.length ? Math.min(...indents) : 0;
  return minimum > 0 ? lines.map((line) => line.slice(minimum)) : lines;
}

export function verifyCandidate(
  files: Map<string, SampledFile>,
  candidate: RawCandidate,
): VerifyResult {
  if (!candidate.rule?.trim()) return { ok: false, reason: 'empty_rule' };
  const file = resolveFile(files, candidate.evidence_path);
  if (!file) return { ok: false, reason: 'unknown_file' };
  const snippetLines = (candidate.evidence_snippet ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\t/, ''))
    .filter((line) => line.trim());
  const head = snippetLines[0];
  if (!head || normalize(head).replace(/\s/g, '').length < MIN_SNIPPET_CHARS) {
    return { ok: false, reason: 'snippet_too_short' };
  }
  const index = findLine(file.lines, head, candidate.evidence_line ?? null);
  if (index === -1) return { ok: false, reason: 'snippet_not_found' };
  const span = Math.min(Math.max(snippetLines.length, 1), MAX_SNIPPET_LINES);
  return {
    ok: true,
    candidate: {
      category: CATEGORIES.includes(candidate.category as ConventionCategory)
        ? (candidate.category as ConventionCategory)
        : 'general',
      rule: candidate.rule.trim(),
      rationale: candidate.rationale?.trim() || null,
      evidencePath: file.path,
      evidenceLine: index + 1,
      evidenceSnippet: dedent(file.lines.slice(index, index + span)).join('\n').trimEnd(),
      confidence: Math.min(1, Math.max(0, candidate.confidence ?? 0)),
    },
  };
}

export function ruleKey(rule: string): string {
  return rule.toLowerCase().replace(/[`'"*_.]/g, '').replace(/\s+/g, ' ').trim();
}

export function dedupeCandidates(
  candidates: VerifiedCandidate[],
  seen: Iterable<string> = [],
): { kept: VerifiedCandidate[]; dropped: number } {
  const keys = new Set(seen);
  const kept: VerifiedCandidate[] = [];
  for (const candidate of candidates) {
    const key = ruleKey(candidate.rule);
    if (keys.has(key)) continue;
    keys.add(key);
    kept.push(candidate);
  }
  return { kept, dropped: candidates.length - kept.length };
}

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId,
    category: row.category,
    rule: row.rule,
    rationale: row.rationale,
    evidence_path: row.evidencePath ?? '',
    evidence_line: row.evidenceLine,
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

export function slugify(text: string, maxWords = 6): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().split(/\s+/)
    .slice(0, maxWords).join('-') || 'rule';
}

export function buildSkillDraft(
  repoFullName: string,
  rows: ConventionRow[],
): ConventionSkillDraft {
  const short = slugify(repoFullName.split('/').pop() ?? repoFullName, 8);
  const name = `${short}-conventions`;
  const sections = rows.map((row) => {
    const lines = [`## ${slugify(row.rule)}`, row.rule.trim()];
    if (row.rationale?.trim()) lines.push('', row.rationale.trim());
    if (row.evidencePath) {
      const at = row.evidenceLine ? `${row.evidencePath}:${row.evidenceLine}` : row.evidencePath;
      lines.push('', `Detected in \`${at}\`:`, '', '```', row.evidenceSnippet ?? '', '```');
    }
    return lines.join('\n');
  });
  return {
    name,
    description: `${rows.length} house convention${rows.length === 1 ? '' : 's'} extracted from ${repoFullName}`,
    type: 'convention',
    body: [
      `# ${name}`,
      '',
      `House conventions for \`${repoFullName}\`, extracted from the repository and confirmed by a maintainer. Flag changes that violate any rule below and cite the offending \`file:line\`. A rule that does not apply to the diff under review is not a finding.`,
      '',
      ...sections,
    ].join('\n'),
    evidence_files: [...new Set(rows.map((row) => row.evidencePath).filter((path): path is string => !!path))],
    convention_ids: rows.map((row) => row.id),
  };
}
