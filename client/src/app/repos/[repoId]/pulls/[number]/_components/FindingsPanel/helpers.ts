import type { FindingRecord, Severity } from "@devdigest/shared";
import { FILTER_SEVERITIES, LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Count a run's findings by the severities exposed as filters. */
export function countFindingsBySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const counts = Object.fromEntries(FILTER_SEVERITIES.map((severity) => [severity, 0])) as Record<
    Severity,
    number
  >;
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** Optionally filter by severity/confidence, then sort by severity. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity: Severity | null = null,
): FindingRecord[] {
  let shown = severity ? findings.filter((finding) => finding.severity === severity) : findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
