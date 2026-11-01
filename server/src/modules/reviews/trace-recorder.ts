import { createHash } from 'node:crypto';
import type {
  PartialOutput,
  PromptAssembly,
  StructuredAttemptTelemetry,
  TraceAttempt,
  TraceDispatch,
  TraceStage,
  TraceUsage,
  UsageState,
} from '@devdigest/shared';
import {
  ProviderOutputError,
  type ReviewStage,
  type ReviewStageAttemptEvent,
  type ReviewStageEvent,
} from '@devdigest/reviewer-core';

/**
 * Collects a run's request lifecycle (stages and their provider attempts) from
 * the engine's `onStage` / `onStageAttempt` sinks, and turns it into the run
 * trace's evidence fields. It holds prompts in memory only: nothing here
 * writes to the run bus or a logger.
 */

/** Bound on one stored stage assembly (UTF-8 bytes of all its sections). */
export const STAGE_ASSEMBLY_MAX_BYTES = 256 * 1024;
/** Bound on all stage assemblies stored in one trace. */
export const STAGE_ASSEMBLIES_TOTAL_MAX_BYTES = 1024 * 1024;

/** Run totals: the ONE object both the agent_runs row and the trace stats are written from. */
export interface RunUsage {
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  state: UsageState;
}

const ASSEMBLY_KEYS = ['system', 'skills', 'memory', 'specs', 'callers', 'repo_map', 'pr_description', 'user'] as const;

/** Canonical bytes of an assembly's prompt sections (skills_tokens is a measurement, not prompt text). */
function canonicalAssembly(assembly: PromptAssembly): string {
  return JSON.stringify(ASSEMBLY_KEYS.map((k) => [k, assembly[k] ?? null]));
}

export function assemblyDigest(assembly: PromptAssembly): { sha256: string; bytes: number } {
  const canonical = canonicalAssembly(assembly);
  let bytes = 0;
  for (const k of ASSEMBLY_KEYS) bytes += Buffer.byteLength(assembly[k] ?? '', 'utf8');
  return { sha256: createHash('sha256').update(canonical, 'utf8').digest('hex'), bytes };
}

/** An assembly cut so its sections total at most `max` bytes (sections in prompt order; never inside a character). */
function boundAssembly(assembly: PromptAssembly, max: number): { assembly: PromptAssembly; bytes: number } {
  let left = max;
  const out: PromptAssembly = { system: '', user: '' };
  for (const k of ASSEMBLY_KEYS) {
    const value = assembly[k];
    if (value === undefined) continue;
    if (value === null) {
      out[k] = null as never;
      continue;
    }
    const buf = Buffer.from(value, 'utf8');
    let end = Math.min(buf.length, Math.max(left, 0));
    while (end > 0 && end < buf.length && (buf[end]! & 0xc0) === 0x80) end--;
    out[k] = buf.subarray(0, end).toString('utf8');
    left -= end;
  }
  return { assembly: out, bytes: max - left };
}

interface StageRecord {
  stage: ReviewStage;
  assembly: PromptAssembly;
  state: TraceStage['state'];
  completedUsage: TraceUsage | null;
  error: unknown;
  attempts: Map<number, TraceAttempt>;
}

const sum = (values: Array<number | null>): number | null =>
  values.some((v) => v === null) ? null : values.reduce<number>((n, v) => n + (v ?? 0), 0);

export class RunTraceRecorder {
  private readonly stages: StageRecord[] = [];

  private find(stageId: string): StageRecord | undefined {
    return this.stages.find((s) => s.stage.stage_id === stageId);
  }

  /** Engine sink: `ReviewInput.onStage`. */
  readonly onStage = (e: ReviewStageEvent): void => {
    if (e.type === 'prepared') {
      this.stages.push({ stage: e.stage, assembly: e.assembly, state: 'prepared', completedUsage: null, error: null, attempts: new Map() });
      return;
    }
    const record = this.find(e.stage_id);
    if (!record) return;
    if (e.type === 'completed') {
      record.state = 'completed';
      record.completedUsage = { tokens_in: e.usage.tokens_in, tokens_out: e.usage.tokens_out, cost_usd: e.usage.provider_cost_usd };
    } else {
      record.state = 'failed';
      record.error = e.error;
    }
  };

  /** Engine sink: `ReviewInput.onStageAttempt`. */
  readonly onStageAttempt = (e: ReviewStageAttemptEvent): void => {
    const record = this.find(e.stage_id);
    if (!record) return;
    let attempt = record.attempts.get(e.attempt);
    if (e.phase === 'submitted' || !attempt) {
      attempt = {
        attempt: e.attempt,
        retry: e.retry,
        phase: 'submitted',
        submitted_at: e.at,
        response_id: null,
        finish_reason: null,
        http_status: null,
        failure: null,
        usage: null,
        verified_usage: null,
      };
      record.attempts.set(e.attempt, attempt);
    }
    if (e.phase === 'response_received') {
      attempt.phase = 'response_received';
      attempt.response_id = e.response_id ?? null;
      attempt.finish_reason = e.finish_reason ?? null;
      attempt.http_status = e.http_status ?? null;
      attempt.usage = e.usage ? { ...e.usage } : null;
    } else if (e.phase === 'usage_verified') {
      attempt.phase = 'usage_verified';
      attempt.verified_usage = e.usage ? { ...e.usage } : null;
    } else if (e.phase === 'failed') {
      attempt.failure = e.outcome ?? null;
      if (e.http_status !== undefined) attempt.http_status = e.http_status;
      if (e.finish_reason !== undefined && e.finish_reason !== null) attempt.finish_reason = e.finish_reason;
    }
  };

  /** Whether any stage was prepared, i.e. handed to a provider adapter. */
  get prepared(): boolean {
    return this.stages.length > 0;
  }

  /** The last prepared stage (the one that failed, when the run failed in a provider call). */
  lastStage(): { stage: ReviewStage; assembly: PromptAssembly } | undefined {
    return this.stages.at(-1);
  }

  /** Mark stages still in flight at a cancellation. */
  cancelOpenStages(): void {
    for (const s of this.stages) if (s.state === 'prepared') s.state = 'cancelled';
  }

  /** A stage's usage: the provider result when it completed; else the typed error's, else its attempts', else unknown. */
  private stageUsage(record: StageRecord): { state: UsageState; usage: TraceUsage } {
    if (record.completedUsage) return { state: 'measured', usage: record.completedUsage };
    const err = record.error;
    if (err instanceof ProviderOutputError) {
      const usage = { tokens_in: err.usage.tokensIn, tokens_out: err.usage.tokensOut, cost_usd: err.usage.costUsd };
      return { state: usage.tokens_in !== null && usage.tokens_out !== null ? 'measured' : 'unknown', usage };
    }
    const attempts = [...record.attempts.values()];
    // Every submitted attempt must have reported a response; an attempt with
    // no response (429, timeout, transport error) has unknown usage.
    if (attempts.length > 0 && attempts.every((a) => a.usage && a.usage.tokens_in !== null && a.usage.tokens_out !== null)) {
      return {
        state: 'measured',
        usage: {
          tokens_in: sum(attempts.map((a) => a.usage!.tokens_in)),
          tokens_out: sum(attempts.map((a) => a.usage!.tokens_out)),
          cost_usd: sum(attempts.map((a) => a.usage!.cost_usd)),
        },
      };
    }
    return { state: 'unknown', usage: { tokens_in: null, tokens_out: null, cost_usd: null } };
  }

  /**
   * Run totals for an ordinary (non-experiment) run. Nothing dispatched:
   * zero tokens (cost as before: null). Any dispatched stage with unknown
   * usage makes the totals unknown (null), never a fallback zero; the known
   * stages keep their usage in `stages[]`.
   */
  totals(): RunUsage {
    if (!this.prepared) return { tokensIn: 0, tokensOut: 0, costUsd: null, state: 'none' };
    const per = this.stages.map((s) => this.stageUsage(s));
    if (per.some((p) => p.state !== 'measured')) return { tokensIn: null, tokensOut: null, costUsd: null, state: 'unknown' };
    return {
      tokensIn: sum(per.map((p) => p.usage.tokens_in)),
      tokensOut: sum(per.map((p) => p.usage.tokens_out)),
      costUsd: sum(per.map((p) => p.usage.cost_usd)),
      state: 'measured',
    };
  }

  /** `stages[]`, each distinct assembly stored once and under the size bounds. */
  traceStages(topLevelSha256: string | null): TraceStage[] {
    const stored = new Set<string>(topLevelSha256 ? [topLevelSha256] : []);
    let budget = STAGE_ASSEMBLIES_TOTAL_MAX_BYTES;
    return this.stages.map((record) => {
      const digest = assemblyDigest(record.assembly);
      const { state: usageState, usage } = this.stageUsage(record);
      const stage: TraceStage = {
        ...record.stage,
        state: record.state,
        assembly_sha256: digest.sha256,
        assembly_bytes: digest.bytes,
        assembly_complete: true,
        usage_state: usageState,
        usage,
        attempts: [...record.attempts.values()].sort((a, b) => a.attempt - b.attempt),
      };
      if (stored.has(digest.sha256)) return stage;
      const limit = Math.min(STAGE_ASSEMBLY_MAX_BYTES, budget);
      if (limit <= 0) return { ...stage, assembly_complete: false, stored_assembly_bytes: 0 };
      const bounded = digest.bytes > limit ? boundAssembly(record.assembly, limit) : { assembly: record.assembly, bytes: digest.bytes };
      budget -= bounded.bytes;
      stored.add(digest.sha256);
      const complete = bounded.bytes === digest.bytes;
      return {
        ...stage,
        assembly: bounded.assembly,
        assembly_complete: complete,
        ...(complete ? {} : { stored_assembly_bytes: bounded.bytes }),
      };
    });
  }
}

/** Run totals for an experiment slot: the attempt telemetry, as the ledger reads it. */
export function experimentTotals(
  attempts: StructuredAttemptTelemetry[],
  dispatched: boolean,
  totals: { tokensIn: number | null; tokensOut: number | null; costUsd: number | null },
): RunUsage {
  if (!dispatched) return { tokensIn: 0, tokensOut: 0, costUsd: 0, state: 'none' };
  // A dispatched slot whose provider reported no attempt has unknown usage: never trust a zero sum.
  if (!attempts.some((a) => a.dispatch === 'dispatched')) return { tokensIn: null, tokensOut: null, costUsd: null, state: 'unknown' };
  return { ...totals, state: totals.tokensIn === null || totals.tokensOut === null ? 'unknown' : 'measured' };
}

/** The bounded, private partial output of a typed provider output error. */
export function partialOutputOf(err: unknown, stageId: string): PartialOutput | null {
  if (!(err instanceof ProviderOutputError)) return null;
  const storedBytes = Buffer.byteLength(err.partialText, 'utf8');
  return {
    kind: err.kind,
    stage_id: stageId,
    text: err.partialText,
    provider_incomplete: true,
    finish_reason: err.finishReason,
    response_id: err.responseId,
    total_bytes: err.partialTotalBytes,
    ...(storedBytes < err.partialTotalBytes ? { truncated_at_bytes: storedBytes } : {}),
    sha256: err.partialSha256,
  };
}

export type { TraceDispatch };
