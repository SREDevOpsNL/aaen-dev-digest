import type { AttemptErrorDetail } from '@devdigest/shared';
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
  /** Frozen value in the confirmatory phase; null in exploration (the server then records, not checks). */
  expectedNonSkillFingerprint: string | null;
  /** For the operator's prompt in Run Review mode. */
  agentName?: string;
  prNumber?: number;
}

interface SlotLookup {
  /** Set when the slot was armed for a Run Review click. */
  arm?: { state: 'armed' | 'consumed' | 'expired' | 'disarmed'; expires_at: string } | null;
  runs: Array<{
    run_id: string;
    status: string | null;
    cost_usd: number | null;
    experiment: {
      dispatch_state?: string;
      refusal_reason?: string | null;
      usage_known?: boolean;
      non_skill_fingerprint?: string | null;
      attempts?: Array<{ outcome?: string; errorDetail?: AttemptErrorDetail | null }>;
    } | null;
  }>;
}

export interface RunnerDeps {
  api: ExperimentApi;
  /** The operator's spending capability token (`cli.ts authorize`), sent as x-hw2-capability. */
  capabilityToken: string;
  ledger: Ledger;
  log: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** Recorded on every ledger event: the ledger is shared by every stack. */
  stackId?: string;
  /**
   * Dispatch through the PR page's Run Review button (criteria 17–18): the
   * runner arms the slot and the operator clicks Run Review for its agent.
   * Absent: the runner dispatches with POST /experiments/runs.
   */
  viaUi?: { prompt: (message: string) => void; clickTimeoutMs: number };
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
    // A slot armed for a Run Review click by a runner that died may still be
    // armed: disarm it first, so no later click can dispatch it (best effort;
    // it also expires on its own, and the slot stays charged in full).
    await deps.api.delete(`/experiments/slots/${slot.slot_id}/arm`, { 'x-hw2-capability': deps.capabilityToken }).catch(() => null);
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
  /** The settled run's non-Skill fingerprint differs from the expected one: stop. */
  fingerprintMismatch?: boolean;
  /** What a failed request said about itself (`describeErrorDetail`), for the operator. */
  diagnosis?: string | null;
};

/**
 * One line from a failed attempt's sanitized error detail: who the body names
 * as the source, the typed and upstream codes, and when to retry. Null when
 * there is nothing to say.
 */
export function describeErrorDetail(detail: AttemptErrorDetail | null | undefined): string | null {
  if (!detail) return null;
  const parts = [
    `origin ${detail.origin}`,
    detail.providerName ? `provider ${detail.providerName}` : null,
    detail.errorType ? `error_type ${detail.errorType}` : null,
    detail.providerCode ? `provider_code ${detail.providerCode}` : null,
    detail.limitSource ? `limit_source ${detail.limitSource}` : null,
    detail.retryAfter ? `retry-after ${detail.retryAfter}` : null,
    detail.requestId ? `request ${detail.requestId}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(', ');
}

const INFRA_OUTCOMES = new Set(['http_error', 'network_error']);

/**
 * How long a slot's run may stay unsettled before it is recorded `ambiguous`.
 * It must cover the experiment request timeout plus the generation lookup's
 * deadline (`test/hw2-generation-lookup.test.ts` checks the margin):
 * 360 s + 65 s + margin.
 */
export const DEFAULT_POLL_TIMEOUT_MS = 480_000;

/** Run one scheduled slot. Never retries it: every outcome is final. */
export async function runSlot(deps: RunnerDeps, run: SlotRun): Promise<SlotResult> {
  const existing = deps.ledger.slots().get(run.slot.slot_id);
  if (existing) throw new Error(`Slot ${run.slot.slot_id} is already in the ledger (${existing.state}); slots are never replayed`);
  const budget = fits([...deps.ledger.slots().values()], run.slot.phase, run.reservationUsd);
  if (!budget.ok) return { state: 'refused', runId: null, costUsd: 0, reason: budget.reason, infraFailure: false };

  const base = {
    slot_id: run.slot.slot_id,
    phase: run.slot.phase,
    reservation_usd: run.reservationUsd,
    ...(deps.stackId ? { stack_id: deps.stackId } : {}),
  };
  deps.ledger.append({ ...base, state: 'reserved', detail: { condition: run.slot.condition, experiment: run.slot.experiment, via: deps.viaUi ? 'run_review' : 'api' } });

  await deps.api.post(`/agents/${run.agentId}/skills`, { skill_ids: run.skillIds });
  // A relink keeps each link's per-agent switch, so a target skill switched
  // off for this agent earlier would silently drop out: switch every one on.
  for (const skillId of run.skillIds) await deps.api.patch(`/agents/${run.agentId}/skills/${skillId}`, { enabled: true });
  const dispatched = deps.viaUi ? await dispatchViaRunReview(deps, run, base) : await dispatchDirect(deps, run, base);
  if ('result' in dispatched) return dispatched.result;
  const runId = dispatched.runId;
  deps.ledger.append({ ...base, state: 'dispatched', run_id: runId });

  const deadline = Date.now() + (deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS);
  while (Date.now() < deadline) {
    await wait(deps, deps.pollIntervalMs ?? 1_000);
    // A poll never outlives the slot's deadline: it gets at most the time that is left.
    const lookup = await deps.api.get<SlotLookup>(`/experiments/slots/${run.slot.slot_id}`, deadline - Date.now()).catch(() => null);
    const current = lookup?.runs.find((r) => r.run_id === runId);
    const settled = current ? terminalOf(current) : null;
    if (settled && current?.status !== 'running') {
      deps.ledger.append({ ...base, state: settled.state, run_id: runId, cost_usd: settled.cost });
      const outcome = current?.experiment?.attempts?.[0]?.outcome;
      const fingerprint = current?.experiment?.non_skill_fingerprint ?? null;
      return {
        fingerprintMismatch:
          settled.state !== 'refused' && run.expectedNonSkillFingerprint !== null && fingerprint !== run.expectedNonSkillFingerprint,
        state: settled.state,
        runId,
        costUsd: settled.cost,
        reason: current?.experiment?.refusal_reason ?? null,
        diagnosis: describeErrorDetail(current?.experiment?.attempts?.[0]?.errorDetail),
        infraFailure: settled.state === 'failed' && outcome !== undefined && INFRA_OUTCOMES.has(outcome),
      };
    }
  }
  deps.ledger.append({ ...base, state: 'ambiguous', run_id: runId, cost_usd: null, detail: { reason: 'poll timeout' } });
  return { state: 'ambiguous', runId, costUsd: null, reason: 'poll timeout', infraFailure: true };
}

type LedgerBase = { slot_id: string; phase: SlotRecord['phase']; reservation_usd: number; stack_id?: string };

/** Dispatch with POST /experiments/runs. A 4xx means nothing was dispatched; anything else is unknown. */
async function dispatchDirect(deps: RunnerDeps, run: SlotRun, base: LedgerBase): Promise<{ runId: string } | { result: SlotResult }> {
  try {
    const { run_id: runId } = await deps.api.post<{ run_id: string }>(
      '/experiments/runs',
      {
        pr_id: run.prId,
        agent_id: run.agentId,
        slot_id: run.slot.slot_id,
        experiment: run.slot.experiment,
        condition: run.slot.condition,
        phase: run.slot.phase,
        manifest_fingerprint: run.manifestFingerprint,
        reservation_usd: run.reservationUsd,
        expected_diff_sha256: run.expectedDiffSha256,
        expected_non_skill_fingerprint: run.expectedNonSkillFingerprint,
      },
      { 'x-hw2-capability': deps.capabilityToken },
    );
    return { runId };
  } catch (err) {
    // 4xx: the server refused before creating a run (nothing dispatched). Anything else is unknown.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      deps.ledger.append({ ...base, state: 'refused', cost_usd: 0, detail: { http_status: err.status, reason: err.message } });
      return { result: { state: 'refused', runId: null, costUsd: 0, reason: err.message, infraFailure: false } };
    }
    deps.ledger.append({ ...base, state: 'ambiguous', cost_usd: null, detail: { reason: (err as Error).message } });
    return { result: { state: 'ambiguous', runId: null, costUsd: null, reason: (err as Error).message, infraFailure: true } };
  }
}

/**
 * Run Review mode: arm the slot, ask the operator to click Run Review for its
 * agent on the PR page, and wait for the run that click starts. A slot that
 * was never dispatched is `refused` (zero cost) only when the server shows it
 * can no longer dispatch: no run, and its arm disarmed, expired or never
 * made. Anything the runner cannot establish is `ambiguous`.
 */
async function dispatchViaRunReview(deps: RunnerDeps, run: SlotRun, base: LedgerBase): Promise<{ runId: string } | { result: SlotResult }> {
  const ui = deps.viaUi!;
  const slotPath = `/experiments/slots/${run.slot.slot_id}`;
  const headers = { 'x-hw2-capability': deps.capabilityToken };
  try {
    const armed = await deps.api.post<{ armed_until: string }>(
      `${slotPath}/arm`,
      {
        pr_id: run.prId,
        agent_id: run.agentId,
        experiment: run.slot.experiment,
        condition: run.slot.condition,
        phase: run.slot.phase,
        manifest_fingerprint: run.manifestFingerprint,
        reservation_usd: run.reservationUsd,
        expected_diff_sha256: run.expectedDiffSha256,
        expected_non_skill_fingerprint: run.expectedNonSkillFingerprint,
      },
      headers,
    );
    ui.prompt(
      `Slot ${run.slot.slot_id} is armed until ${armed.armed_until}: open PR #${run.prNumber ?? '?'} and click Run Review for "${run.agentName ?? run.agentId}" once.`,
    );
  } catch (err) {
    // 4xx: the server refused to arm it, so nothing can dispatch.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      deps.ledger.append({ ...base, state: 'refused', cost_usd: 0, detail: { http_status: err.status, reason: err.message } });
      return { result: { state: 'refused', runId: null, costUsd: 0, reason: err.message, infraFailure: false } };
    }
    return settleUnclicked(deps, run, base, `arm failed: ${(err as Error).message}`);
  }

  const deadline = Date.now() + ui.clickTimeoutMs;
  while (Date.now() < deadline) {
    await wait(deps, deps.pollIntervalMs ?? 1_000);
    const lookup = await deps.api.get<SlotLookup>(slotPath, deadline - Date.now()).catch(() => null);
    const found = lookup?.runs[0];
    if (found) return { runId: found.run_id };
    const state = lookup?.arm?.state;
    if (lookup && (state === 'expired' || state === 'disarmed')) {
      deps.ledger.append({ ...base, state: 'refused', cost_usd: 0, detail: { reason: `arm ${state} without a Run Review click` } });
      return { result: { state: 'refused', runId: null, costUsd: 0, reason: `arm ${state} without a Run Review click`, infraFailure: false } };
    }
  }
  return settleUnclicked(deps, run, base, 'no Run Review click before the runner deadline');
}

/** Disarm, then decide from what the server shows; never assume a slot did not dispatch. */
async function settleUnclicked(deps: RunnerDeps, run: SlotRun, base: LedgerBase, reason: string): Promise<{ runId: string } | { result: SlotResult }> {
  const slotPath = `/experiments/slots/${run.slot.slot_id}`;
  await deps.api.delete(`${slotPath}/arm`, { 'x-hw2-capability': deps.capabilityToken }).catch(() => null);
  const lookup = await deps.api.get<SlotLookup>(slotPath).catch(() => null);
  // A click that landed at the last moment started a run: follow it like any other.
  if (lookup?.runs[0]) return { runId: lookup.runs[0].run_id };
  const state = lookup?.arm?.state ?? null;
  if (lookup && lookup.runs.length === 0 && (state === null || state === 'disarmed' || state === 'expired')) {
    deps.ledger.append({ ...base, state: 'refused', cost_usd: 0, detail: { reason, arm_state: state } });
    return { result: { state: 'refused', runId: null, costUsd: 0, reason, infraFailure: false } };
  }
  deps.ledger.append({ ...base, state: 'ambiguous', cost_usd: null, detail: { reason, arm_state: state, lookup: lookup ? 'ok' : 'failed' } });
  return { result: { state: 'ambiguous', runId: null, costUsd: null, reason, infraFailure: true } };
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
    deps.log(`${run.slot.slot_id}: ${result.state}${result.reason ? ` — ${result.reason}` : ''}${result.diagnosis ? ` (${result.diagnosis})` : ''}`);
    if (result.state === 'refused' && result.runId === null && /budget/.test(result.reason ?? '')) return { results, stopped: result.reason };
    if (result.state === 'refused' && rules.stopOnRefusal) return { results, stopped: `guard refusal on ${run.slot.slot_id}: ${result.reason}` };
    if (result.fingerprintMismatch) return { results, stopped: `${run.slot.slot_id} did not reproduce the frozen non-Skill fingerprint` };
    unknownCost = result.costUsd === null ? unknownCost + 1 : 0;
    if (unknownCost >= rules.maxConsecutiveUnknownCost) return { results, stopped: `${unknownCost} consecutive slots with unknown cost` };
    infra = result.infraFailure ? infra + 1 : 0;
    if (infra >= rules.maxConsecutiveInfraFailures) return { results, stopped: `${infra} consecutive infrastructure failures` };
  }
  return { results, stopped: null };
}
