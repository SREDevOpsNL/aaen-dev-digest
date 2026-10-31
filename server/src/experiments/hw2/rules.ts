/**
 * Expected-finding rules, written into the pre-registration before any counted
 * run: a finding detects the defect when it cites an expected anchor (file and
 * overlapping lines) and its title or rationale matches at least one keyword
 * predicate.
 */

export interface ExpectedRule {
  anchors: Array<{ file: string; start_line: number; end_line: number }>;
  /** Case-insensitive regular expressions; at least one must match. */
  keywords: string[];
}

export interface FindingLike {
  file: string;
  start_line: number;
  end_line: number;
  title: string;
  rationale: string;
}

const overlaps = (a: { start_line: number; end_line: number }, b: { start_line: number; end_line: number }) =>
  Math.min(a.start_line, a.end_line) <= Math.max(b.start_line, b.end_line) &&
  Math.min(b.start_line, b.end_line) <= Math.max(a.start_line, a.end_line);

export function matchesRule(finding: FindingLike, rule: ExpectedRule): boolean {
  const anchored = rule.anchors.some((anchor) => anchor.file === finding.file && overlaps(anchor, finding));
  if (!anchored) return false;
  const text = `${finding.title}\n${finding.rationale}`;
  return rule.keywords.some((pattern) => new RegExp(pattern, 'i').test(text));
}

/** Whether a run detected the defect, and which findings matched. */
export function detection(findings: FindingLike[], rule: ExpectedRule): { detected: boolean; matched: string[] } {
  const matched = findings.filter((finding) => matchesRule(finding, rule)).map((finding) => finding.title);
  return { detected: matched.length > 0, matched };
}

/** Pre-registered success rule: with-skill ≥ 4 of 5 detections and without-skill ≤ 1 of 5. */
export function experimentOutcome(withDetections: number, withCounted: number, withoutDetections: number, withoutCounted: number) {
  if (withCounted < 5 || withoutCounted < 5) return 'incomplete' as const;
  if (withDetections >= 4 && withoutDetections <= 1) return 'success' as const;
  if (withDetections <= withoutDetections) return 'negative' as const;
  return 'inconclusive' as const;
}
