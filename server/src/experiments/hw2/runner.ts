import type { AttemptErrorDetail } from '@devdigest/shared';
import { ApiError, type ExperimentApi } from './api.js';
import { fits } from './budget.js';
import { isTerminal, type Ledger, type SlotRecord, type SlotState } from './ledger.js';
import type { Slot } from './schedule.js';
import { reconcileExtraction } from './conventions-runner.js';
import { evaluateSlot, truncationCheck, type FrozenExpectations, type TruncationProvenance } from './eligibility.js';
import type { StudySemantics } from './manifest.js';
import {
  THROTTLE_STOPS, attemptPlan, modelPacing, modelPolicy, outcomeOfClass, parseAttemptId, protocolNext, throttleProblems,
  type AttemptClassification, type AttemptPolicyP3, type AttemptRunView,
} from './attempt-policy.js';
import { TAGGED_SLOT_ID } from './schedule.js';
import { traceProblems, type AttemptOutcome, type PlannedAttempt } from './throttle-policy.js';

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
  /**
   * Skill ids linked for this condition (target only, or none). Null keeps the
   * links the operator arranged in the UI (exploration only: the trace-evidence
   * slot for criteria 14, 19 and 20, whose order is set by drag-and-drop).
   */
  skillIds: string[] | null;
  manifestFingerprint: string;
  expectedDiffSha256: string;
  reservationUsd: number;
  /** Frozen value in the confirmatory phase; null in exploration (the server then records, not checks). */
  expectedNonSkillFingerprint: string | null;
  /** For the operator's prompt in Run Review mode. */
  agentName?: string;
  prNumber?: number;
  /**
   * The frozen manifest's semantics (`studySemantics`). Absent, or a version 3
   * manifest: a truncated confirmatory slot stops the schedule, as in v3.
   */
  semantics?: StudySemantics;
  /** The frozen provenance a truncated slot must still show to continue (v4 and v5). */
  expectations?: FrozenExpectations;
  /**
   * Version 5 only: this run is one predeclared attempt of a trial (`slot`
   * then carries the attempt ID). Set by `runAttemptPool`, never by hand.
   */
  attempt?: AttemptContext;
}

/** Where an attempt sits in the frozen v5 plan. */
export interface AttemptContext {
  study_id: string;
  trial_id: string;
  attempt: number;
  plan_index: number;
  /** The predeclared wait before it was armed (applied by the runner). */
  delay_before_ms: number;
  policy: AttemptPolicyP3;
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
  /**
   * The predeclared v5 pacing waits (30 s, 60 s, 180 s); defaults to `sleep`,
   * then a real timer. Separate from the poll interval so tests can record
   * exactly the pacing.
   */
  pacingSleep?: (ms: number) => Promise<void>;
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
    if (slot.events[0]?.detail?.operation === 'conventions.extract') {
      const sameStack = slot.events[0]?.stack_id === deps.stackId;
      const repoId = slot.events[0]?.detail?.repository_id;
      const outcome = await reconcileExtraction(
        deps.ledger, slot.slot_id, sameStack ? deps.api : undefined,
        typeof repoId === 'string' ? repoId : undefined, deps.ledger.dir,
      );
      deps.log(`reconciled extraction ${slot.slot_id}: ${outcome.state}`);
      continue;
    }
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
      const expected = slot.events[0]?.detail?.expected_non_skill_fingerprint;
      const actual = lookup.runs[0]?.experiment?.non_skill_fingerprint ?? null;
      const fingerprintMismatch = slot.phase === 'confirmatory' &&
        (typeof expected !== 'string' || actual !== expected);
      deps.ledger.append({
        slot_id: slot.slot_id, phase: slot.phase, reservation_usd: slot.reservation_usd,
        state: settled.state, run_id: lookup.runs[0]!.run_id, cost_usd: settled.cost,
        detail: { reconciled: true, fingerprint_mismatch: fingerprintMismatch },
      });
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
  /**
   * Set only under a frozen `continue-impute` truncation rule, for a slot
   * whose one attempt was truncated: `continue` when it is otherwise sound
   * (known cost, frozen fingerprint, full provenance), else the problems.
   */
  truncation?: { continue: boolean; problems: string[]; provenance: TruncationProvenance | null };
  /** Version 5 attempts only: what the protocol makes of the settled attempt (`classifyAttempt`). */
  p3?: AttemptClassification;
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
  if (run.skillIds === null && run.slot.phase !== 'exploration') throw new Error(`Slot ${run.slot.slot_id}: operator links (trace-evidence) are exploration only`);
  const budget = fits([...deps.ledger.slots().values()], run.slot.phase, run.reservationUsd);
  if (!budget.ok) return { state: 'refused', runId: null, costUsd: 0, reason: budget.reason, infraFailure: false };

  const base = {
    slot_id: run.slot.slot_id,
    phase: run.slot.phase,
    reservation_usd: run.reservationUsd,
    ...(deps.stackId ? { stack_id: deps.stackId } : {}),
  };
  // Read before the reservation: a stack that cannot list the links costs nothing.
  const before = run.skillIds === null ? null : await linkSnapshot(deps, run.agentId);
  deps.ledger.append({
    ...base,
    state: 'reserved',
    detail: {
      condition: run.slot.condition,
      experiment: run.slot.experiment,
      via: deps.viaUi ? 'run_review' : 'api',
      links: run.skillIds === null ? 'operator' : 'condition',
      // Operator links make a trace-only run: evidence for criteria 14, 19 and
      // 20, never part of an experiment's with/without comparison.
      purpose: run.skillIds === null ? 'trace-evidence' : 'comparison',
      expected_non_skill_fingerprint: run.expectedNonSkillFingerprint,
      // Version 5: the attempt's place in the frozen plan, for the restart and report cross-checks.
      ...(run.attempt ? {
        p3_attempt: {
          study_id: run.attempt.study_id, trial_id: run.attempt.trial_id, attempt: run.attempt.attempt,
          plan_index: run.attempt.plan_index, delay_before_ms: run.attempt.delay_before_ms,
        },
      } : {}),
    },
  });

  if (run.skillIds === null || before === null) return dispatchAndFollow(deps, run, base);
  // The operator's arrangement (order and per-agent switches) is put back after
  // the slot, so a later trace-evidence slot runs with the links as dragged.
  try {
    await deps.api.post(`/agents/${run.agentId}/skills`, { skill_ids: run.skillIds });
    // A relink keeps each link's per-agent switch, so a target skill switched
    // off for this agent earlier would silently drop out: switch every one on.
    for (const skillId of run.skillIds) await deps.api.patch(`/agents/${run.agentId}/skills/${skillId}`, { enabled: true });
    return await dispatchAndFollow(deps, run, base);
  } finally {
    await restoreLinks(deps, run.agentId, before);
  }
}

type LinkSnapshot = Array<{ skill_id: string; link_enabled: boolean }>;

async function linkSnapshot(deps: RunnerDeps, agentId: string): Promise<LinkSnapshot> {
  const links = await deps.api.get<LinkSnapshot>(`/agents/${agentId}/skills`);
  return Array.isArray(links) ? links.map((l) => ({ skill_id: l.skill_id, link_enabled: l.link_enabled })) : [];
}

/** Best effort: a failed restore is reported, never turned into a slot outcome. */
async function restoreLinks(deps: RunnerDeps, agentId: string, before: LinkSnapshot): Promise<void> {
  try {
    await deps.api.post(`/agents/${agentId}/skills`, { skill_ids: before.map((l) => l.skill_id) });
    for (const link of before) await deps.api.patch(`/agents/${agentId}/skills/${link.skill_id}`, { enabled: link.link_enabled });
  } catch (err) {
    deps.log(`WARNING: could not restore the agent's skill links: ${(err as Error).message}; re-arrange them before a trace-evidence slot`);
  }
}

async function dispatchAndFollow(deps: RunnerDeps, run: SlotRun, base: LedgerBase): Promise<SlotResult> {
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
      const outcome = current?.experiment?.attempts?.[0]?.outcome;
      const fingerprint = current?.experiment?.non_skill_fingerprint ?? null;
      const fingerprintMismatch = settled.state !== 'refused' &&
        run.expectedNonSkillFingerprint !== null && fingerprint !== run.expectedNonSkillFingerprint;
      const truncation = truncationOutcome(run, settled, current!, fingerprintMismatch);
      const p3 = run.attempt ? classifyAttempt(run, current!) : null;
      deps.ledger.append({
        ...base, state: settled.state, run_id: runId, cost_usd: settled.cost,
        detail: {
          fingerprint_mismatch: fingerprintMismatch,
          ...(truncation ? {
            attempt_outcome: 'truncated',
            truncation: truncation.continue ? 'continue' : 'stop',
            truncation_provenance: truncation.provenance,
            truncation_problems: truncation.problems,
          } : {}),
          ...(p3 ? { p3 } : {}),
        },
      });
      return {
        ...(p3 ? { p3 } : {}),
        ...(truncation ? { truncation } : {}),
        fingerprintMismatch,
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

/** Whether the frozen manifest lets a truncated confirmatory slot continue the schedule (versions 4 and 5). */
const continuesOnTruncation = (run: SlotRun) =>
  run.slot.phase === 'confirmatory' && (run.semantics?.version === 4 || run.semantics?.version === 5) && run.semantics.truncation === 'continue-impute';

/**
 * A settled confirmatory slot whose single attempt was truncated, under a
 * frozen `continue-impute` rule: it continues only with a known cost, the
 * frozen non-Skill fingerprint and full provenance. Null when the rule does
 * not apply (v3, exploration, or not a truncation): the slot is handled as before.
 */
function truncationOutcome(
  run: SlotRun,
  settled: { state: SlotState; cost: number | null },
  current: SlotLookup['runs'][number],
  fingerprintMismatch: boolean,
): { continue: boolean; problems: string[]; provenance: TruncationProvenance | null } | null {
  if (!continuesOnTruncation(run) || settled.state !== 'failed') return null;
  if (current.experiment?.attempts?.length !== 1 || current.experiment.attempts[0]?.outcome !== 'truncated') return null;
  const problems: string[] = [];
  let provenance: TruncationProvenance | null = null;
  if (settled.cost === null) problems.push('unknown cost');
  if (fingerprintMismatch) problems.push('non-Skill fingerprint differs from the frozen one');
  if (!run.expectations) problems.push('no frozen provenance expectations');
  else {
    // The provenance level the frozen v4 semantics accept (`truncationCheck`).
    const check = truncationCheck(current, run.expectations, run.semantics!.truncationProvenance);
    if (!check.truncated) problems.push('the attempt is not a dispatched, truncated generation');
    problems.push(...check.problems);
    provenance = check.provenance;
  }
  return problems.length === 0 ? { continue: true, problems, provenance } : { continue: false, problems, provenance: null };
}

/** A recorded confirmatory slot the frozen v4 rule let continue: truncated, known cost, frozen fingerprint. */
function acceptedTruncation(run: SlotRun, recorded: SlotRecord): boolean {
  if (!continuesOnTruncation(run) || recorded.state !== 'failed' || recorded.cost_usd === null) return false;
  const terminal = recorded.events.find((event) => event.state === recorded.state);
  return terminal?.detail?.truncation === 'continue' && terminal.detail.fingerprint_mismatch === false;
}

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
  // A version 5 trial is never dispatched under its own ID: only its attempts are, by `runAttemptPool`.
  if (runs.some((run) => run.semantics?.version === 5 || run.attempt)) throw new Error('A version 5 schedule runs only through runAttemptPool');
  const results: Array<SlotResult & { slot_id: string }> = [];
  let unknownCost = 0;
  let infra = 0;
  for (const run of runs) {
    const recorded = deps.ledger.slots().get(run.slot.slot_id);
    if (recorded && isTerminal(recorded.state)) {
      const terminal = recorded.events.find((event) => event.state === recorded.state);
      if (run.slot.phase === 'confirmatory' && !acceptedTruncation(run, recorded) &&
          (recorded.state !== 'completed' || recorded.cost_usd === null ||
           terminal?.detail?.fingerprint_mismatch !== false)) {
        return { results, stopped: 'confirmatory slot ' + run.slot.slot_id +
          ' was previously incomplete; refusing to continue the frozen schedule' };
      }
      continue;
    }
    const result = await runSlot(deps, run);
    results.push({ ...result, slot_id: run.slot.slot_id });
    deps.log(`${run.slot.slot_id}: ${result.state}${result.reason ? ` — ${result.reason}` : ''}${result.diagnosis ? ` (${result.diagnosis})` : ''}`);
    if (result.truncation) {
      deps.log(result.truncation.continue
        ? `${run.slot.slot_id}: truncated; terminal, not retried; provenance ${result.truncation.provenance}; the frozen v4 rule continues the schedule and imputes it against the hypothesis`
        : `${run.slot.slot_id}: truncated, but ${result.truncation.problems.join('; ')}`);
    }
    if (result.state === 'refused' && result.runId === null && /budget/.test(result.reason ?? '')) return { results, stopped: result.reason };
    if (result.state === 'refused' && rules.stopOnRefusal) return { results, stopped: `guard refusal on ${run.slot.slot_id}: ${result.reason}` };
    if (result.fingerprintMismatch) return { results, stopped: `${run.slot.slot_id} did not reproduce the frozen non-Skill fingerprint` };
    // A confirmatory schedule has fixed slots and no replacement sampling.
    // Stop on the first unsuccessful or potentially billed slot, regardless
    // of the more tolerant exploratory consecutive-failure defaults.
    if (run.slot.phase === 'confirmatory' && result.truncation?.continue !== true &&
        (result.state !== 'completed' || result.costUsd === null || result.infraFailure)) {
      return { results, stopped: 'confirmatory slot ' + run.slot.slot_id + ' is incomplete: ' + (result.reason ?? result.state) };
    }
    unknownCost = result.costUsd === null ? unknownCost + 1 : 0;
    if (unknownCost >= rules.maxConsecutiveUnknownCost) return { results, stopped: `${unknownCost} consecutive slots with unknown cost` };
    infra = result.infraFailure ? infra + 1 : 0;
    if (infra >= rules.maxConsecutiveInfraFailures) return { results, stopped: `${infra} consecutive infrastructure failures` };
  }
  return { results, stopped: null };
}

// ---------------------------------------------------------------------------
// Study v5: the P3 attempt pool
// ---------------------------------------------------------------------------

/**
 * What the v5 protocol makes of one settled attempt, from the stack's
 * structured record only:
 * - `throttled`: a strictly classified upstream pre-generation 429
 *   (`throttleProblems`) that reproduced the frozen non-Skill fingerprint;
 * - `truncated`: a truncation the frozen v4 rule lets continue (imputed);
 * - `observed`: completed, known cost, frozen fingerprint, and strict
 *   single-generation provenance on the frozen provider and served model;
 * - `failed`: everything else, with the reasons. It stops the study.
 */
export function classifyAttempt(run: SlotRun, current: SlotLookup['runs'][number]): AttemptClassification {
  if (!run.attempt) throw new Error(`Slot ${run.slot.slot_id} is not a v5 attempt`);
  const settled = terminalOf(current);
  if (!settled || current.status === 'running') return { class: 'failed', reasons: ['the attempt did not settle'] };
  if (settled.state === 'refused') return { class: 'failed', reasons: [`refused by the stack: ${current.experiment?.refusal_reason ?? 'no reason'}`] };
  const fingerprint = current.experiment?.non_skill_fingerprint ?? null;
  const fingerprintMismatch = run.expectedNonSkillFingerprint === null || fingerprint !== run.expectedNonSkillFingerprint;
  const reasons: string[] = [];
  if (fingerprintMismatch) reasons.push('non-Skill fingerprint differs from the frozen one');
  if (!run.expectations) reasons.push('no frozen provenance expectations');
  if (settled.state === 'failed') {
    const throttle = throttleProblems(current as AttemptRunView, run.attempt.policy.throttle_classification, run.expectations ?? null);
    if (throttle.length === 0 && reasons.length === 0) return { class: 'throttled', reasons: [] };
    const truncation = truncationOutcome(run, settled, current, fingerprintMismatch);
    if (truncation?.continue && reasons.length === 0) return { class: 'truncated', reasons: [] };
    return { class: 'failed', reasons: [...new Set([...reasons, ...(truncation ? truncation.problems : throttle.map((p) => `not a classified 429: ${p}`))])] };
  }
  if (settled.cost === null) reasons.push('unknown cost');
  if (run.expectations) {
    const eligibility = evaluateSlot(current, run.expectations);
    if (!eligibility.eligible) reasons.push(...eligibility.reasons);
  }
  return reasons.length === 0 ? { class: 'observed', reasons } : { class: 'failed', reasons };
}

/**
 * The narrow v5 exception to the consecutive unknown-cost and infrastructure
 * stops: a classified 429 has unknown cost and is an HTTP error by
 * construction, so it neither counts toward nor resets them. Every other
 * attempt counts as before.
 */
export const exemptFromUnknownCostStop = (result: Pick<SlotResult, 'p3'>) => result.p3?.class === 'throttled';

export interface AttemptPoolResult {
  results: Array<SlotResult & { slot_id: string; trial_id: string; attempt: number }>;
  stopped: string | null;
  /** Where the protocol stands after this run (`done` when every trial is resolved). */
  state: ReturnType<typeof protocolNext> | null;
}

interface HistoryStep {
  attempt: PlannedAttempt;
  outcome: AttemptOutcome;
  delay_before_ms: number;
}

/**
 * The recorded attempts of the frozen plan, in ledger order, with the
 * protocol outcome of each. A restarted runner continues only from a history
 * the protocol could have produced: no trial ID dispatched on its own, no
 * attempt outside the plan, each reservation naming its own place in the
 * plan, and the whole sequence accepted by `traceProblems` (in-progress form).
 */
async function attemptHistory(deps: RunnerDeps, studyId: string, trials: SlotRun[], plan: PlannedAttempt[], slotTag: string): Promise<{ steps: HistoryStep[] } | { problem: string }> {
  const records = deps.ledger.slots();
  const byId = new Map(plan.map((a) => [a.attempt_id, a]));
  const trialIds = new Set(trials.map((t) => t.slot.slot_id));
  const order: string[] = [];
  for (const event of deps.ledger.events()) if (!order.includes(event.slot_id)) order.push(event.slot_id);
  const steps: HistoryStep[] = [];
  for (const id of order) {
    if (trialIds.has(id)) return { problem: `trial ID ${id} is in the ledger; a v5 trial is dispatched only under its attempt IDs` };
    const planned = byId.get(id);
    if (!planned) {
      if (parseAttemptId(id)?.tag === slotTag || TAGGED_SLOT_ID.exec(id)?.[1] === slotTag) return { problem: `${id} is in the ledger but not in the frozen attempt plan` };
      continue;
    }
    const record = records.get(id)!;
    const marker = record.events[0]?.detail?.p3_attempt as { trial_id?: unknown; attempt?: unknown; plan_index?: unknown; delay_before_ms?: unknown } | undefined;
    if (!marker || marker.trial_id !== planned.trial_id || marker.attempt !== planned.attempt || marker.plan_index !== planned.plan_index) {
      return { problem: `${id}'s reservation does not record its place in the frozen plan` };
    }
    const terminal = record.events.find((event) => event.state === record.state);
    let classification = terminal?.detail?.p3 as AttemptClassification | undefined;
    if (!classification && terminal?.detail?.reconciled === true && (record.state === 'completed' || record.state === 'failed')) {
      // Reconciled after a crash: classify again from the stack's durable record, with the frozen inputs.
      const trial = trials[planned.trial_index]!;
      let lookup: SlotLookup;
      try {
        lookup = await deps.api.get<SlotLookup>(`/experiments/slots/${id}`);
      } catch (err) {
        return { problem: `cannot classify the reconciled attempt ${id}: ${(err as Error).message}` };
      }
      const found = lookup.runs.length === 1 && lookup.runs[0]!.run_id === record.run_id ? lookup.runs[0]! : null;
      classification = found
        ? classifyAttempt({ ...trial, slot: { ...trial.slot, slot_id: id }, attempt: attemptContext(planned, trial, studyId) }, found)
        : { class: 'failed', reasons: ['the reconciled run cannot be found again'] };
      deps.log(`${id}: reconciled attempt classified ${classification.class}${classification.reasons.length ? ` (${classification.reasons.join('; ')})` : ''}`);
    }
    const c = classification ?? { class: 'failed' as const, reasons: [`${record.state} without a classification`] };
    steps.push({ attempt: planned, outcome: outcomeOfClass(c.class), delay_before_ms: typeof marker.delay_before_ms === 'number' ? marker.delay_before_ms : Number.NaN });
  }
  const policy = trials[0]!.semantics!.attemptPolicy!;
  const problems = traceProblems(
    trials.map((t) => t.slot), modelPolicy(policy),
    steps.map((s) => ({ attempt_id: s.attempt.attempt_id, outcome: s.outcome, delay_before_ms: s.delay_before_ms })),
    modelPacing(policy), { prefix: true },
  );
  return problems.length > 0 ? { problem: problems.join('; ') } : { steps };
}

function attemptContext(planned: PlannedAttempt, trial: SlotRun, studyId: string): AttemptContext {
  return {
    study_id: studyId, trial_id: planned.trial_id, attempt: planned.attempt, plan_index: planned.plan_index,
    delay_before_ms: planned.delay_before_ms, policy: trial.semantics!.attemptPolicy!,
  };
}

/**
 * Run a frozen version 5 schedule under its P3 attempt pool. `trials` are the
 * seeded trials in order (each a `SlotRun` carrying the v5 semantics and the
 * frozen expectations). Attempts are armed in plan order; after a classified
 * 429 the same trial's next attempt is armed after its predeclared delay;
 * a trial whose pool is exhausted is left missing and the next trial follows;
 * the study stops on the outage limit, the attempt cap, and on everything the
 * confirmatory runner already stops on (any unclassified failure, unknown
 * cost apart from a classified 429, a refusal, a fingerprint mismatch, a
 * provenance gap). Each attempt is an ordinary slot: its own ID, its own
 * reservation on disk before dispatch, never replayed.
 */
export async function runAttemptPool(deps: RunnerDeps, study: { id: string }, trials: SlotRun[], rules: StopRules = DEFAULT_STOP_RULES): Promise<AttemptPoolResult> {
  const unresolved = deps.ledger.unresolved();
  if (unresolved.length > 0) throw new Error(`Reconcile first: ${unresolved.map((s) => s.slot_id).join(', ')} are not terminal`);
  const policy = trials[0]?.semantics?.attemptPolicy;
  if (!policy || trials.some((t) => t.semantics?.version !== 5 || t.semantics.attemptPolicy !== policy || t.slot.phase !== 'confirmatory' || t.attempt)) {
    throw new Error('runAttemptPool needs the confirmatory trials of one frozen version 5 schedule');
  }
  if (trials.some((t) => !t.expectations || t.expectedNonSkillFingerprint === null)) throw new Error('Every v5 trial needs its frozen provenance expectations and non-Skill fingerprint');
  const slotTag = trials[0]!.semantics!.slotTag!;
  const plan = attemptPlan(trials.map((t) => t.slot), policy);
  const model = modelPolicy(policy);
  const history = await attemptHistory(deps, study.id, trials, plan, slotTag);
  if ('problem' in history) return { results: [], stopped: `refusing to continue the frozen attempt plan: ${history.problem}`, state: null };
  const steps = history.steps.map(({ attempt, outcome }) => ({ attempt, outcome }));
  let state = protocolNext(plan, model, steps);
  if (state.kind === 'stopped' && !THROTTLE_STOPS.has(state.reason)) {
    return { results: [], stopped: `confirmatory attempt ${state.attempt_id} was previously incomplete; refusing to continue the frozen schedule`, state };
  }
  const pace = deps.pacingSleep ?? deps.sleep ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t)));
  const results: AttemptPoolResult['results'] = [];
  let unknownCost = 0;
  let infra = 0;
  const stop = (stopped: string | null): AttemptPoolResult => ({ results, stopped, state });
  while (state.kind === 'next') {
    const planned = state.attempt;
    const trial = trials[planned.trial_index]!;
    if (planned.delay_before_ms > 0) {
      deps.log(`${planned.attempt_id}: waiting ${planned.delay_before_ms / 1000} s (predeclared, outcome-independent)`);
      await pace(planned.delay_before_ms);
    }
    const run: SlotRun = { ...trial, slot: { ...trial.slot, slot_id: planned.attempt_id }, attempt: attemptContext(planned, trial, study.id) };
    const result = await runSlot(deps, run);
    results.push({ ...result, slot_id: planned.attempt_id, trial_id: planned.trial_id, attempt: planned.attempt });
    const c: AttemptClassification = result.p3 ?? { class: 'failed', reasons: [result.reason ?? result.state] };
    deps.log(`${planned.attempt_id} (trial ${planned.trial_index + 1}, ${planned.condition}, a${planned.attempt}): ${result.state}, ${c.class}${result.diagnosis ? ` (${result.diagnosis})` : ''}`);
    if (result.state === 'refused' && result.runId === null && /budget/.test(result.reason ?? '')) return stop(result.reason!);
    if (result.state === 'refused' && rules.stopOnRefusal) return stop(`guard refusal on ${planned.attempt_id}: ${result.reason}`);
    if (result.fingerprintMismatch) return stop(`${planned.attempt_id} did not reproduce the frozen non-Skill fingerprint`);
    steps.push({ attempt: planned, outcome: outcomeOfClass(c.class) });
    if (!exemptFromUnknownCostStop(result)) {
      unknownCost = result.costUsd === null ? unknownCost + 1 : 0;
      infra = result.infraFailure ? infra + 1 : 0;
    }
    state = protocolNext(plan, model, steps);
    if (c.class === 'failed') return stop(`confirmatory attempt ${planned.attempt_id} is incomplete: ${c.reasons.join('; ') || result.state}`);
    if (unknownCost >= rules.maxConsecutiveUnknownCost) return stop(`${unknownCost} consecutive slots with unknown cost`);
    if (infra >= rules.maxConsecutiveInfraFailures) return stop(`${infra} consecutive infrastructure failures`);
    if (c.class === 'throttled' && planned.attempt === policy.attempts_per_trial && state.kind !== 'stopped') {
      deps.log(`${planned.trial_id}: pool exhausted (${planned.attempt} classified 429s); the trial is missing (bounded) and the next trial follows`);
    }
  }
  if (state.kind === 'stopped') {
    const why = state.reason === 'throttle_outage'
      ? `outage stop: ${policy.outage_consecutive_429} consecutive classified 429s (last ${state.attempt_id})`
      : state.reason === 'attempt_cap' ? `attempt cap: ${policy.max_total_attempts} attempts used` : `${state.reason} at ${state.attempt_id}`;
    return stop(why);
  }
  return stop(null);
}
