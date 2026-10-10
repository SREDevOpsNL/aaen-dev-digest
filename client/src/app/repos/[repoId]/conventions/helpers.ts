import type { ConventionCandidate } from "@devdigest/shared";
import {
  CONFIDENCE_OK,
  CONFIDENCE_WARN,
  FILTER_STATUSES,
  type ConventionFilter,
} from "./constants";

export function filterCandidates(
  candidates: ConventionCandidate[],
  filter: ConventionFilter,
): ConventionCandidate[] {
  const allowed = FILTER_STATUSES[filter];
  const list = allowed ? candidates.filter((candidate) => allowed.includes(candidate.status)) : [...candidates];
  return list.sort((left, right) => right.confidence - left.confidence);
}

export function countByStatus(candidates: ConventionCandidate[]) {
  return {
    pending: candidates.filter((candidate) => candidate.status === "pending").length,
    accepted: candidates.filter((candidate) => candidate.status === "accepted").length,
    rejected: candidates.filter((candidate) => candidate.status === "rejected").length,
    all: candidates.length,
  };
}

export function confidenceColor(confidence: number): string {
  if (confidence >= CONFIDENCE_OK) return "var(--ok)";
  if (confidence >= CONFIDENCE_WARN) return "var(--warn)";
  return "var(--text-muted)";
}

export function evidenceLabel(path: string, line?: number | null): string {
  return line ? `${path}:${line}` : path;
}

export function githubEvidenceUrl(
  fullName: string | undefined,
  branch: string | undefined,
  path: string,
  line?: number | null,
): string | null {
  if (!fullName || !path) return null;
  const ref = branch || "HEAD";
  const segments = path.split("/").map(encodeURIComponent).join("/");
  const anchor = line ? `#L${line}` : "";
  return `https://github.com/${fullName}/blob/${encodeURIComponent(ref)}/${segments}${anchor}`;
}
