import type { LogLine } from "@devdigest/ui";
import type { RunTrace } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

export type RunStatusLabel = "running" | "completed" | "failed" | "cancelled";

/** Header status label from the persisted agent_runs.status (running | done |
   failed | cancelled). A live SSE stream overrides it with "running"; an
   unknown status yields null so the header never claims success it can't see. */
export function runStatusLabel(status: string | null | undefined, live: boolean): RunStatusLabel | null {
  if (live) return "running";
  switch (status) {
    case "running":
    case "failed":
    case "cancelled":
      return status;
    case "done":
      return "completed";
    default:
      return null;
  }
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}
