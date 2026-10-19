/**
 * HW2 experiment runner CLI (talks only to a disposable DevDigest API).
 *
 *   pnpm exec tsx src/experiments/hw2/cli.ts <command> [--flag value …]
 *
 * Unpaid: endpoints · check · plan · manifest · reconcile · report
 * Paid:   run  (refuses unless --authorized-gate matches the phase, --confirm-spend
 *         is set, the ledger lock is free, every identity check passes and the
 *         ledger is reconciled; confirmatory also needs a committed preregistration
 *         whose manifest fingerprint equals the current one)
 *
 * The full procedure is in docs/plans/HW2-experiment-operator-guide.md.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { INTENT_PROMPT_VERSION } from '@devdigest/reviewer-core';
import { EXPERIMENT_FIXTURES } from '../../db/seed-fixtures.js';
import { canonicalJson, sha256 } from '../../modules/_shared/experiment.js';
import { ExperimentApi } from './api.js';
import { CAPS, scheduleFits, spent } from './budget.js';
import { evaluateSlot } from './eligibility.js';
import { containerLabels, identityProblems, type StackIdentity } from './identity.js';
import { Ledger } from './ledger.js';
import { EXPERIMENT_FIXTURE, buildManifest, fixtureDiffSha, manifestFingerprint, type Manifest } from './manifest.js';
import { reconcile, runSchedule, type SlotRun } from './runner.js';
import { buildSchedule, slotId, type Phase, type Slot } from './schedule.js';

type Flags = Record<string, string | true>;

export function parseArgs(argv: string[]): { command: string; flags: Flags } {
  const [command = 'help', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument ${arg}`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = true;
    else {
      flags[arg.slice(2)] = next;
      i++;
    }
  }
  return { command, flags };
}

const need = (flags: Flags, name: string): string => {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--${name} is required`);
  return value;
};

/** Gate flags must name the phase's own gate (exploration = 3, confirmatory = 4). */
export function assertPaidAuthorization(flags: Flags): Phase {
  const phase = need(flags, 'phase');
  if (phase !== 'exploration' && phase !== 'confirmatory') throw new Error('--phase must be exploration or confirmatory');
  const gate = need(flags, 'authorized-gate');
  const required = phase === 'exploration' ? '3' : '4';
  if (gate !== required) throw new Error(`--authorized-gate ${gate} does not authorize the ${phase} phase (needs Gate ${required})`);
  if (flags['confirm-spend'] !== true) throw new Error('--confirm-spend is required for paid runs');
  return phase;
}

const ledgerDir = (stackId: string) => join(homedir(), '.devdigest', 'hw2-experiments', stackId);

interface Stack {
  api: ExperimentApi;
  identity: StackIdentity;
  stackId: string;
}

/** Identity checks that must all pass before anything else (fail closed). */
async function verifiedStack(flags: Flags): Promise<Stack> {
  const apiUrl = need(flags, 'api');
  const stackId = need(flags, 'stack');
  const expected = { stackId, database: need(flags, 'database'), container: need(flags, 'container'), apiUrl };
  const api = new ExperimentApi(apiUrl);
  const identity = await api.get<StackIdentity>('/experiments/identity');
  const problems = identityProblems(identity, await containerLabels(expected.container), expected);
  if (problems.length > 0) throw new Error(`Stack identity check failed:\n- ${problems.join('\n- ')}`);
  return { api, identity, stackId };
}

async function lookupIds(api: ExperimentApi) {
  const repos = await api.get<Array<{ id: string; full_name: string }>>('/repos');
  const repo = repos.find((r) => r.full_name === 'acme/payments-api');
  if (!repo) throw new Error('acme/payments-api not found');
  const pulls = await api.get<Array<{ id?: string | null; number: number }>>(`/repos/${repo.id}/pulls`);
  const agents = await api.get<Array<{ id: string; name: string; system_prompt: string; model: string; strategy: string; repo_intel: boolean }>>('/agents');
  const skills = await api.get<Array<{ id: string; name: string; body: string }>>('/skills');
  const prId = (n: number) => pulls.find((p) => p.number === n)?.id ?? null;
  return { prId, agents, skills };
}

async function currentManifest(flags: Flags, stack: Stack): Promise<Manifest> {
  const { agents, skills } = await lookupIds(stack.api);
  const seed = Number(need(flags, 'seed'));
  const slots = buildSchedule({ seed, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 });
  const rules = JSON.parse(readFileSync(need(flags, 'rules'), 'utf8')) as Manifest['rules'];
  const reviewers = EXPERIMENT_FIXTURES.map((f) => f.reviewer);
  const targets = EXPERIMENT_FIXTURES.map((f) => f.targetSkill);
  return buildManifest({
    codeSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    stack: {
      database: stack.identity.database,
      provider: stack.identity.provider,
      providerName: stack.identity.provider_name,
      model: stack.identity.model,
      maxOutputTokens: stack.identity.max_output_tokens,
      prices: (stack.identity as unknown as { prices: unknown }).prices,
      generationLookup: (stack.identity as unknown as { generation_lookup: unknown }).generation_lookup,
    },
    skills: skills.filter((s) => targets.includes(s.name)).map((s) => ({ name: s.name, body: s.body })),
    agents: agents.filter((a) => reviewers.includes(a.name)),
    schedule: { seed, slots },
    rules,
    perSlotReservationUsd: Number(need(flags, 'reservation')),
  });
}

/** The manifest JSON block of a committed, unmodified preregistration file. */
export function preregisteredManifest(file: string): Manifest {
  execFileSync('git', ['ls-files', '--error-unmatch', file], { stdio: 'pipe' });
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', file], { stdio: 'pipe' });
  } catch {
    throw new Error(`${file} has uncommitted changes; commit the preregistration before any confirmatory run`);
  }
  const match = /```json manifest\n([\s\S]*?)\n```/.exec(readFileSync(file, 'utf8'));
  if (!match) throw new Error(`${file} has no \`\`\`json manifest block`);
  return JSON.parse(match[1]!) as Manifest;
}

async function slotRuns(stack: Stack, slots: Slot[], manifest: Manifest | null, reservationUsd: number, fingerprint: string): Promise<SlotRun[]> {
  const { prId, agents, skills } = await lookupIds(stack.api);
  return Promise.all(
    slots.map(async (slot) => {
      const fixture = EXPERIMENT_FIXTURES.find((f) => f.number === EXPERIMENT_FIXTURE[slot.experiment])!;
      const agent = agents.find((a) => a.name === fixture.reviewer);
      const target = skills.find((s) => s.name === fixture.targetSkill);
      const pr = prId(fixture.number);
      if (!agent || !target || !pr) throw new Error(`Experiment ${slot.experiment}: reviewer, target skill or PR missing`);
      const frozen = manifest?.fixtures.find((f) => f.number === fixture.number)?.diff_sha256 ?? (await fixtureDiffSha(fixture));
      return {
        slot,
        prId: pr,
        agentId: agent.id,
        skillIds: slot.condition === 'with' ? [target.id] : [],
        manifestFingerprint: fingerprint,
        expectedDiffSha256: frozen,
        reservationUsd,
      };
    }),
  );
}

export async function main(argv: string[], log: (m: string) => void = console.log): Promise<void> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case 'endpoints': {
      const api = new ExperimentApi(need(flags, 'api'));
      log(JSON.stringify(await api.get('/experiments/endpoints'), null, 2));
      return;
    }
    case 'check': {
      const stack = await verifiedStack(flags);
      const { prId } = await lookupIds(stack.api);
      for (const fixture of EXPERIMENT_FIXTURES) {
        const intent = await stack.api.get<{ state: string; stale: boolean }>(`/pulls/${prId(fixture.number)}/intent`);
        if (intent.state !== 'ready' || intent.stale) throw new Error(`PR #${fixture.number}: cached intent is not fresh`);
        log(`PR #${fixture.number}: intent fresh; frozen diff sha256 ${await fixtureDiffSha(fixture)}`);
      }
      log(`stack ${stack.stackId} on ${stack.identity.database}: isolation checks passed`);
      return;
    }
    case 'plan': {
      const slots = buildSchedule({ seed: Number(need(flags, 'seed')), phase: 'confirmatory', experiments: ['17', '18'], trials: Number(flags.trials ?? 5) });
      const json = JSON.stringify(slots, null, 2);
      if (typeof flags.out === 'string') writeFileSync(flags.out, `${json}\n`);
      log(json);
      return;
    }
    case 'manifest': {
      const stack = await verifiedStack(flags);
      const manifest = await currentManifest(flags, stack);
      if (!scheduleFits(manifest.schedule.slots.length, manifest.per_slot_reservation_usd)) {
        throw new Error(`${manifest.schedule.slots.length} slots × $${manifest.per_slot_reservation_usd} exceed the $${CAPS.confirmatory} confirmatory cap`);
      }
      const json = JSON.stringify(manifest, null, 2);
      if (typeof flags.out === 'string') writeFileSync(flags.out, `${json}\n`);
      log(`manifest fingerprint ${manifestFingerprint(manifest)}`);
      return;
    }
    case 'reconcile': {
      const stack = await verifiedStack(flags);
      const ledger = new Ledger(ledgerDir(stack.stackId));
      ledger.acquire({ pid: process.pid, stackId: stack.stackId });
      try {
        await reconcile({ api: stack.api, ledger, log });
      } finally {
        ledger.release();
      }
      return;
    }
    case 'run': {
      const phase = assertPaidAuthorization(flags);
      const stack = await verifiedStack(flags);
      if (!stack.identity.openrouter_key_configured) {
        throw new Error(`No OpenRouter key in ${stack.identity.secrets_path}; Gate 2 (the dedicated key and its limit) comes first`);
      }
      const ledger = new Ledger(ledgerDir(stack.stackId));
      ledger.acquire({ pid: process.pid, stackId: stack.stackId });
      try {
        await reconcile({ api: stack.api, ledger, log });
        let runs: SlotRun[];
        if (phase === 'confirmatory') {
          const file = resolve(need(flags, 'prereg'));
          const frozen = preregisteredManifest(file);
          const current = await currentManifest({ ...flags, seed: String(frozen.schedule.seed), reservation: String(frozen.per_slot_reservation_usd) }, stack);
          if (manifestFingerprint(current) !== manifestFingerprint(frozen)) {
            throw new Error('The current stack, code or content does not match the preregistered manifest');
          }
          const slots = buildSchedule({ seed: frozen.schedule.seed, phase, experiments: ['17', '18'], trials: 5 });
          runs = await slotRuns(stack, slots, frozen, frozen.per_slot_reservation_usd, manifestFingerprint(frozen));
        } else {
          const experiment = need(flags, 'experiment');
          const condition = need(flags, 'condition') as 'with' | 'without';
          const count = Number(flags.count ?? 1);
          const taken = [...ledger.slots().keys()];
          const slots: Slot[] = [];
          for (let trial = 1; slots.length < count; trial++) {
            const id = slotId('exploration', experiment, condition, trial);
            if (!taken.includes(id)) slots.push({ slot_id: id, index: slots.length, phase, experiment, condition, trial });
          }
          runs = await slotRuns(stack, slots, null, Number(need(flags, 'reservation')), 'e'.repeat(64));
        }
        const { stopped } = await runSchedule({ api: stack.api, ledger, log }, runs);
        const all = [...ledger.slots().values()];
        log(`charged: ${phase} $${spent(all, phase).toFixed(6)} of $${CAPS[phase]}, total $${spent(all).toFixed(6)} of $${CAPS.total}`);
        if (stopped) log(`STOPPED: ${stopped}`);
      } finally {
        ledger.release();
      }
      return;
    }
    case 'report': {
      const stack = await verifiedStack(flags);
      const ledger = new Ledger(ledgerDir(stack.stackId));
      const lines = ['| Slot | State | Cost (USD) | Eligible | Reasons |', '| --- | --- | --- | --- | --- |'];
      const providerName = need(flags, 'provider-name');
      for (const slot of ledger.slots().values()) {
        const lookup = await stack.api.get<{ runs: Array<{ experiment: unknown; intent: unknown }> }>(`/experiments/slots/${slot.slot_id}`);
        const experiment = slot.slot_id.split('-')[1]!;
        const fixture = EXPERIMENT_FIXTURES.find((f) => f.number === EXPERIMENT_FIXTURE[experiment])!;
        const verdict = evaluateSlot(lookup.runs[0] ?? null, {
          providerName,
          model: stack.identity.model,
          // The seeded intent: no derivation id, the fixture head, the current prompt version, its analysis.
          intent: {
            derivation_id: null,
            head_sha: fixture.headSha,
            prompt_version: INTENT_PROMPT_VERSION,
            analysis_sha: sha256(canonicalJson(fixture.intent.analysis)),
          },
          expectedDiffSha256: await fixtureDiffSha(fixture),
        });
        lines.push(`| ${slot.slot_id} | ${slot.state} | ${slot.cost_usd ?? 'unknown'} | ${verdict.eligible ? 'yes' : 'no'} | ${verdict.reasons.join('; ') || '—'} |`);
      }
      const table = lines.join('\n');
      if (typeof flags.out === 'string') writeFileSync(flags.out, `${table}\n`);
      log(table);
      return;
    }
    default:
      log('commands: endpoints | check | plan | manifest | reconcile | run | report (see docs/plans/HW2-experiment-operator-guide.md)');
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`hw2-experiments: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
