import { ApiError, type ExperimentApi } from './api.js';
import { fits } from './budget.js';
import { isTerminal, type Ledger, type SlotRecord, type SlotState } from './ledger.js';
import type { Slot } from './schedule.js';

/**
 * Orchestration of paid experiment slots against the disposable API. It is
 * only ever invoked by `cli.ts run` after the operator's explicit gate flag;
 * tests drive it with a fake API. Order per slot: budget check → reservation
 * on disk → condition setup (skill links) → one POST → poll → terminal record.
 */

export interface SlotRun {
  slot: Slot;
  prId: string;
  agentId: string;
  /** Skill ids linked for this condition (target only, or none). */
  skillIds: string[];
  manifestFingerprint: string;
  expectedDiffSha256: string;
  reservationUsd: number;
}

interface SlotLookup {
  runs: Array<{
    run_id: string;
    status: string | null;
    cost_usd: number | null;
    experiment: {
      dispatch_state?: string;
      refusal_reason?: string | null;
      usage_known?: boolean;
      attempts?: Array<{ outcome?: string }>;
    } | null;
  }>;
}

export interface RunnerDeps {
  api: ExperimentApi;
  ledger: Ledger;
  log: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

const wait = (deps: RunnerDeps, ms: number) => (deps.sleep ?? ((t) => new Promise((r) => setTimeout(r, t))))(ms);

/** Map a settled run to a terminal ledger state. */
function terminalOf(run: SlotLookup['runs'][number]): { state: SlotState; cost: number | null } | null {
  const state = run.experiment?.dispatch_state;
  if (state === 'refused') return { state: 'refused', cost: 0 };
  if (state === 'completed') return { state: 'completed', cost: run.experiment?.usage_known ? run.cost_usd : null };
  if (state === 'failed') return { state: 'failed', cost: run.experiment?.usage_known ? run.cost_usd : null };
  return null; // dispatching, or no experiment block
}

/**
 * Before any further paid request: settle every slot left reserved or
 * dispatched by an earlier (possibly crashed) runner. A slot whose outcome the
 * API cannot show becomes `ambiguous` and keeps its full reservation.
 */
export async function reconcile(deps: RunnerDeps): Promise<SlotRecord[]> {
  for (const slot of deps.ledger.unresolved()) {
    let lookup: SlotLookup;
    try {
      lookup = await deps.api.get<SlotLookup>(`/experiments/slots/${slot.slot_id}`);
    } catch (err) {
      throw new Error(`Cannot reconcile ${slot.slot_id}: ${(err as Error).message}; no paid request until it is resolved`);
    }
    const settled = lookup.runs.length === 1 ? terminalOf(lookup.runs[0]!) : null;
    if (settled) {
      deps.ledger.append({ slot_id: slot.slot_id, phase: slot.phase, reservation_usd: slot.reservation_usd, state: settled.state, run_id: lookup.runs[0]!.run_id, cost_usd: settled.cost, detail: { reconciled: true } });
      deps.log(`reconciled ${slot.slot_id}: ${settled.state}`);
    } else {
      deps.ledger.append({
        slot_id: slot.slot_id,
        phase: slot.phase,
        reservation_usd: slot.reservation_usd,
        state: 'ambiguous',
        run_id: lookup.runs[0]?.run_id ?? slot.run_id,
        cost_usd: null,
        detail: { reconciled: true, runs_found: lookup.runs.length },
      });
      deps.log(`reconciled ${slot.slot_id}: ambiguous (charged at its reservation, never replayed)`);
    }
  }
  return [...deps.ledger.slots().values()];
}

export type SlotResult = {
  state: SlotState;
  runId: string | null;
  costUsd: number | null;
  reason: string | null;
  /** True for an HTTP/network failure or an ambiguous slot; a schema-invalid answer is an outcome, not infra. */
  infraFailure: boolean;
};

const INFRA_OUTCOMES = new Set(['http_error', 'network_error']);

/** Run one scheduled slot. Never retries it: every outcome is final. */
export async function runSlot(deps: RunnerDeps, run: SlotRun): Promise<SlotResult> {
  const existing = deps.ledger.slots().get(run.slot.slot_id);
  if (existing) throw new Error(`Slot ${run.slot.slot_id} is already in the ledger (${existing.state}); slots are never replayed`);
  const budget = fits([...deps.ledger.slots().values()], run.slot.phase, run.reservationUsd);
  if (!budget.ok) return { state: 'refused', runId: null, costUsd: 0, reason: budget.reason, infraFailure: false };

  const base = { slot_id: run.slot.slot_id, phase: run.slot.phase, reservation_usd: run.reservationUsd };
  deps.ledger.append({ ...base, state: 'reserved', detail: { condition: run.slot.condition, experiment: run.slot.experiment } });

  await deps.api.post(`/agents/${run.agentId}/skills`, { skill_ids: run.skillIds });
  let runId: string;
  try {
    ({ run_id: runId } = await deps.api.post<{ run_id: string }>('/experiments/runs', {
      pr_id: run.prId,
      agent_id: run.agentId,
      slot_id: run.slot.slot_id,
      experiment: run.slot.experiment,
      condition: run.slot.condition,
      manifest_fingerprint: run.manifestFingerprint,
      reservation_usd: run.reservationUsd,
      expected_diff_sha256: run.expectedDiffSha256,
    }));
  } catch (err) {
    // 4xx: the server refused before creating a run (nothing dispatched). Anything else is unknown.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      deps.ledger.append({ ...base, state: 'refused', cost_usd: 0, detail: { http_status: err.status, reason: err.message } });
      return { state: 'refused', runId: null, costUsd: 0, reason: err.message, infraFailure: false };
    }
    deps.ledger.append({ ...base, state: 'ambiguous', cost_usd: null, detail: { reason: (err as Error).message } });
    return { state: 'ambiguous', runId: null, costUsd: null, reason: (err as Error).message, infraFailure: true };
  }
  deps.ledger.append({ ...base, state: 'dispatched', run_id: runId });

  const deadline = Date.now() + (deps.pollTimeoutMs ?? 180_000);
  while (Date.now() < deadline) {
    await wait(deps, deps.pollIntervalMs ?? 1_000);
    const lookup = await deps.api.get<SlotLookup>(`/experiments/slots/${run.slot.slot_id}`).catch(() => null);
    const current = lookup?.runs.find((r) => r.run_id === runId);
    const settled = current ? terminalOf(current) : null;
    if (settled && current?.status !== 'running') {
      deps.ledger.append({ ...base, state: settled.state, run_id: runId, cost_usd: settled.cost });
      const outcome = current?.experiment?.attempts?.[0]?.outcome;
      return {
        state: settled.state,
        runId,
        costUsd: settled.cost,
        reason: current?.experiment?.refusal_reason ?? null,
        infraFailure: settled.state === 'failed' && outcome !== undefined && INFRA_OUTCOMES.has(outcome),
      };
    }
  }
  deps.ledger.append({ ...base, state: 'ambiguous', run_id: runId, cost_usd: null, detail: { reason: 'poll timeout' } });
  return { state: 'ambiguous', runId, costUsd: null, reason: 'poll timeout', infraFailure: true };
}

export interface StopRules {
  /** Stop after this many consecutive slots whose cost is unknown (default 2). */
  maxConsecutiveUnknownCost: number;
  /** Stop after this many consecutive infrastructure failures (default 3). */
  maxConsecutiveInfraFailures: number;
  /** In the confirmatory phase any refusal means a guard mismatch: stop. */
  stopOnRefusal: boolean;
}

export const DEFAULT_STOP_RULES: StopRules = { maxConsecutiveUnknownCost: 2, maxConsecutiveInfraFailures: 3, stopOnRefusal: true };

/** Run the schedule in order, skipping slots already terminal, stopping on any stop rule. */
export async function runSchedule(
  deps: RunnerDeps,
  runs: SlotRun[],
  rules: StopRules = DEFAULT_STOP_RULES,
): Promise<{ results: Array<SlotResult & { slot_id: string }>; stopped: string | null }> {
  const unresolved = deps.ledger.unresolved();
  if (unresolved.length > 0) throw new Error(`Reconcile first: ${unresolved.map((s) => s.slot_id).join(', ')} are not terminal`);
  const results: Array<SlotResult & { slot_id: string }> = [];
  let unknownCost = 0;
  let infra = 0;
  for (const run of runs) {
    const recorded = deps.ledger.slots().get(run.slot.slot_id);
    if (recorded && isTerminal(recorded.state)) continue;
    const result = await runSlot(deps, run);
    results.push({ ...result, slot_id: run.slot.slot_id });
    deps.log(`${run.slot.slot_id}: ${result.state}${result.reason ? ` — ${result.reason}` : ''}`);
    if (result.state === 'refused' && result.runId === null && /budget/.test(result.reason ?? '')) return { results, stopped: result.reason };
    if (result.state === 'refused' && rules.stopOnRefusal) return { results, stopped: `guard refusal on ${run.slot.slot_id}: ${result.reason}` };
    unknownCost = result.costUsd === null ? unknownCost + 1 : 0;
    if (unknownCost >= rules.maxConsecutiveUnknownCost) return { results, stopped: `${unknownCost} consecutive slots with unknown cost` };
    infra = result.infraFailure ? infra + 1 : 0;
    if (infra >= rules.maxConsecutiveInfraFailures) return { results, stopped: `${infra} consecutive infrastructure failures` };
  }
  return { results, stopped: null };
}
