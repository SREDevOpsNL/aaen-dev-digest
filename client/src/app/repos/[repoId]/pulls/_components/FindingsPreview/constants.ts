import type { IconName } from "@devdigest/ui";

/** Severities shown as counts, in display order. */
export const PREVIEW_SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

export type PreviewSeverity = (typeof PREVIEW_SEVERITIES)[number];

/** Color + icon per severity (matches the L01 design's SEV map). */
export const SEVERITY_META: Record<PreviewSeverity, { color: string; icon: IconName }> = {
  CRITICAL: { color: "var(--crit)", icon: "AlertOctagon" },
  WARNING: { color: "var(--warn)", icon: "AlertTriangle" },
  SUGGESTION: { color: "var(--sugg)", icon: "Lightbulb" },
};

/**
 * The fields the preview renders. Both the PR-list summary preview and a full
 * FindingRecord satisfy it; end_line is absent from the PR-list projection.
 */
export type PreviewFinding = {
  severity: string;
  title: string;
  category: string;
  file: string;
  start_line: number;
  end_line?: number;
  confidence: number;
  rationale: string;
};
