import type { Container } from '../../platform/container.js';
import type { ExperimentRunTrace, Provider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { skillsSectionTokens, taskLine, toSkillPromptBlock } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import { sha256, type ExperimentRunContext } from '../_shared/experiment.js';
import {
  ExperimentRefusedError,
  attemptTotals,
  finishBlock,
  prepareExperimentSlot,
  type ExperimentBatch,
  type ExperimentSlot,
} from './experiment-run.js';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
    experiment?: ExperimentRunContext,
  ): Promise<void> {
    try {
      await this.executeBatch(workspaceId, pull, repo, jobs, logger, experiment);
    } finally {
      experiment?.onSettled?.();
    }
  }

  private async executeBatch(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
    experiment?: ExperimentRunContext,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: null,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);
    // HW2 experiment: the hash of the exact diff text this review uses; the
    // slot is refused unless it equals the frozen fixture hash.
    const experimentBatch: ExperimentBatch | undefined = experiment
      ? { ctx: experiment, diffSha256: sha256(diff.raw) }
      : undefined;

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(workspaceId, pull, repo, diff, agent, runId, runLog, experimentBatch);
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
    experiment?: ExperimentBatch,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // HW2 experiment slot state; set once its checks pass (see experiment-run.ts).
    let slot: ExperimentSlot | undefined;
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    try {
      // A run cancelled while it waited behind earlier agents stops here.
      await this.checkpoint(runId);

      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      const { promptInput, sessionId, skillBlocks } = await this.buildPromptInput(pull, repo, diff, agent, runLog);

      if (experiment) {
        slot = await prepareExperimentSlot({
          batch: experiment,
          agent,
          repo,
          cloneDir: this.container.config.cloneDir,
          llm,
          tokenizer: this.container.tokenizer,
          promptInput,
          sessionId,
        });
        // Durable before dispatch: a crash after this point leaves the slot on record.
        await this.repo.saveRunTrace(runId, {
          ...this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start),
          experiment: slot.block,
        });
        runLog.info(`Experiment slot ${slot.block.slot_id} (${slot.block.condition}): checks passed, dispatching one request`);
      }
      const activeSlot = slot;

      const outcome = await reviewPullRequest({
        ...promptInput,
        model: agent.model,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        sessionId,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => this.checkpoint(runId),
        ...(activeSlot
          ? { experiment: activeSlot.options, onAttempt: (attempt) => activeSlot.attempts.push(attempt) }
          : {}),
      });
      const { tokensIn, tokensOut, grounding } = outcome;

      const keptFindings = outcome.review.findings;

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Persist atomically: run → done, review, findings, reviewed head ---
      // One transaction guarded on status = 'running'. A cancel that landed
      // after the model returned wins: nothing is written and the run stays
      // cancelled. The reviewed head is marked so the PR list can tell
      // reviewed / needs-review (head moved) / stale apart.
      await this.checkpoint(runId);
      const persisted = await this.repo.finalizeRunSuccess({
        runId,
        completion: {
          durationMs,
          tokensIn,
          tokensOut,
          costUsd: outcome.providerCostUsd,
          findingsCount: keptFindings.length,
          grounding,
          score: outcome.review.score,
          blockers,
          error: null,
        },
        review: {
          workspaceId,
          prId: pull.id,
          agentId: agent.id,
          runId,
          kind: 'review',
          verdict: outcome.review.verdict,
          summary: outcome.review.summary,
          score: outcome.review.score,
          model: agent.model,
        },
        findings: keptFindings,
        prId: pull.id,
        headSha: pull.headSha,
      });
      if (!persisted.applied) throw new RunCancelledError();
      const { review, findings: findingRows } = persisted;
      runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

      // ---- Observability: ONE run_traces document ---------------------------

      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: outcome.providerCostUsd,
          findings: findingRows.length,
          grounding,
        },
        prompt_assembly: {
          ...outcome.assembly,
          // Same renderer as assemblePrompt, so this is the section the model received.
          skills_tokens: skillsSectionTokens(skillBlocks, this.container.tokenizer),
        },
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        specs_read: [],
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
        ...(slot ? { experiment: finishBlock(slot, 'completed') } : {}),
      };
      runLog.info('Run complete; trace persisted');
      await this.repo.saveRunTrace(runId, trace);
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      // HW2 experiment: a refusal cost nothing; a dispatched failure records
      // only what the provider reported, never a synthesized zero.
      let experimentBlock: ExperimentRunTrace | undefined;
      let usage: { tokensIn: number | null; tokensOut: number | null; costUsd: number | null } = {
        tokensIn: 0,
        tokensOut: 0,
        costUsd: null,
      };
      if (err instanceof ExperimentRefusedError) {
        experimentBlock = err.block;
        usage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
      } else if (slot) {
        experimentBlock = finishBlock(slot, 'failed', msg);
        usage = attemptTotals(slot.attempts);
      }
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          ...usage,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      await this.repo
        .saveRunTrace(runId, {
          ...this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start),
          ...(experimentBlock ? { experiment: experimentBlock } : {}),
        })
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * HW2 free preview: everything an experiment slot checks before dispatch
   * (diff hash, agent, clone, endpoints, preflight) and its
   * fingerprints, without a model request, a run row or a trace. Returns the
   * block a run would record, or the refusal.
   */
  async previewExperiment(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    agent: AgentRow,
    experiment: ExperimentRunContext,
  ): Promise<{ ok: boolean; reason: string | null; block: ExperimentRunTrace }> {
    const runLog = new RunLogger(this.container.runBus, [], undefined, { prId: pull.id });
    const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repo);
    const llm = await this.container.llm(agent.provider as Provider);
    const { promptInput, sessionId } = await this.buildPromptInput(pull, repo, diff, agent, runLog);
    try {
      const slot = await prepareExperimentSlot({
        batch: { ctx: experiment, diffSha256: sha256(diff.raw) },
        agent,
        repo,
        cloneDir: this.container.config.cloneDir,
        llm,
        tokenizer: this.container.tokenizer,
        promptInput,
        sessionId,
        preview: true,
      });
      return { ok: true, reason: null, block: slot.block };
    } catch (err) {
      if (err instanceof ExperimentRefusedError) return { ok: false, reason: err.reason, block: err.block };
      throw err;
    }
  }

  /**
   * The review's prompt inputs, built once: the engine receives exactly these,
   * and an experiment slot (or its free preview) measures and fingerprints
   * exactly these.
   */
  private async buildPromptInput(
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runLog: RunLogger,
  ) {
    // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
    // skip all enrichment entirely so its prompt is identical to the
    // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
    // flag, which still gates the facade internally.
    const repoIntelOn = agent.repoIntel !== false;
    if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

    // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
    // returns []; we omit the section and behavior is identical to the
    // pre-T1.3 prompt (acceptance #10).
    const callersDigest = repoIntelOn
      ? await this.buildCallersDigest(pull.repoId, diff, runLog)
      : undefined;

    // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
    // effort: when repo-intel is off / unindexed the facade degrades and the
    // prompt is identical to the pre-T3 shape.
    const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
    const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

    const task = taskLine(pull) + rankNote;

    // User-editable skill text is resolved from the same workspace in link
    // order. reviewer-core wraps every block as untrusted data before it can
    // reach the model; it is guidance to evaluate, never executable content.
    const skillBlocks = await this.buildSkillBlocks(agent.id, runLog);

    // ---- Engine: assemble → single-pass → grounding -----------------------
    // The pure review pipeline lives in @devdigest/reviewer-core (shared with
    // the CI runner). The service owns only I/O: repo-intel context resolution
    // above, and persistence + observability below.
    // The prompt inputs, built once: the engine receives exactly these, and an
    // experiment slot measures and fingerprints exactly these.
    const promptInput = {
      systemPrompt: agent.systemPrompt,
      diff,
      ...(skillBlocks.length > 0 ? { skills: skillBlocks } : {}),
      // T1.3 — pass the callers digest only when we built one. assemblePrompt
      // omits the section when this is empty/undefined.
      ...(callersDigest ? { callers: callersDigest } : {}),
      // T3 — repo skeleton, same omit-when-empty contract.
      ...(repoMap ? { repoMap } : {}),
      // PR author's description/body — untrusted; assemblePrompt wraps +
      // truncates it. Omitted when the PR has no body.
      ...(pull.body ? { prDescription: pull.body } : {}),
      task,
    };
    const sessionId = `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`;
    return { promptInput, sessionId, skillBlocks };
  }

  /**
   * Cancellation checkpoint. The in-memory flag is only a fast path: cancelRun
   * completes the bus right after signalling, which clears it. The durable
   * `agent_runs.status = 'cancelled'` row is the authoritative signal.
   */
  private async checkpoint(runId: string): Promise<void> {
    if (this.container.runBus.isCancelled(runId) || (await this.repo.isRunCancelled(runId))) {
      throw new RunCancelledError();
    }
  }

  /** Best-effort prompt enrichment; a lookup failure degrades to no skills. */
  private async buildSkillBlocks(agentId: string, runLog: RunLogger): Promise<string[]> {
    try {
      const links = await this.agents.enabledSkillsForPrompt(agentId);
      if (links.length === 0) return [];
      const blocks = links.map(({ skill }) => toSkillPromptBlock(skill));
      runLog.info(`skills: ${links.length} enabled and attached`);
      return blocks;
    } catch (error) {
      runLog.info(`skills: skipped — ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: {
        duration_ms: durationMs,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: null,
        findings: 0,
        grounding,
      },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
