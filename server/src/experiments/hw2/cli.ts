/**
 * HW2 experiment runner CLI (talks only to a disposable DevDigest API).
 *
 *   pnpm exec tsx src/experiments/hw2/cli.ts <command> [--flag value …]
 *
 * Unpaid: endpoints · check · plan · manifest · reconcile · report
 * Authorization: authorize (writes the server-side spending capability for one
 *   phase; only after that phase's gate was explicitly authorized)
 * Paid:   run (refuses unless --authorized-gate matches the phase, --confirm-spend
 *   is set, the dedicated key exists, the capability token exists, the ledger
 *   lock is free, every identity check passes and the ledger is reconciled;
 *   confirmatory also needs a committed, unmodified pre-registration whose
 *   manifest equals the one recomputed now). The server checks the capability,
 *   phase and budget again on every slot.
 *
 * The full procedure is in docs/plans/HW2-experiment-operator-guide.md.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXPERIMENT_FIXTURES } from '../../db/seed-fixtures.js';
import { toSkillPromptBlock } from '../../modules/reviews/helpers.js';
import { EXPERIMENT_CAPS, PHASE_GATE, canonicalJson, sha256, type ExperimentCapability } from '../../modules/_shared/experiment.js';
import { ExperimentApi } from './api.js';
import { CAPS, scheduleFits, spent } from './budget.js';
import { containerLabels, identityProblems, type StackIdentity } from './identity.js';
import { Ledger } from './ledger.js';
import { EXPERIMENT_FIXTURE, buildManifest, fixtureDiffSha, manifestFingerprint, type Manifest } from './manifest.js';
import { buildReport, renderReport, type SlotRunData } from './report.js';
import type { ExpectedRule, FindingLike } from './rules.js';
import { reconcile, runSchedule, type SlotRun } from './runner.js';
import { buildSchedule, slotId, type Phase, type Slot } from './schedule.js';
import { implementationFingerprint, preregisteredManifest, repoRoot } from './source.js';

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
  const required = String(PHASE_GATE[phase]);
  if (gate !== required) throw new Error(`--authorized-gate ${gate} does not authorize the ${phase} phase (needs Gate ${required})`);
  if (flags['confirm-spend'] !== true) throw new Error('--confirm-spend is required for paid runs');
  return phase;
}

export const experimentDir = (stackId: string, home = homedir()) => join(home, '.devdigest', 'hw2-experiments', stackId);
const tokenFile = (stackId: string, home?: string) => join(experimentDir(stackId, home), 'capability.token');

/** Create `path` exclusively (mode 0600): fails if anything, a symlink included, is already there. */
function writeExclusive(path: string, content: string): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

/** Stacks other than `stackId` whose directory holds a `capability.json` (a symlink counts). */
function otherLiveCapabilities(stackId: string, home?: string): string[] {
  const root = join(home ?? homedir(), '.devdigest', 'hw2-experiments');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => {
    if (!name.startsWith('hw2f-') || name === stackId) return false;
    try {
      lstatSync(join(root, name, 'capability.json'));
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Write the server-side spending capability for one phase (stores only the
 * token's hash) and the token for this runner (mode 0600). Run only after the
 * phase's gate was explicitly authorized.
 *
 * Enforced on every authorization path, not only the guide's X3 block:
 * - never replaces anything: an existing `capability.json` or
 *   `capability.token` (or a symlink at either path) is refused;
 * - refused while another stack holds a live `capability.json`, because what
 *   it spends is in no ledger yet;
 * - one `authorize` at a time across all stacks (`authorize.lock`, created
 *   exclusively and removed afterwards; a leftover one is refused, not stolen).
 */
export function writeCapability(args: { stackId: string; phase: Phase; budgetUsd: number; hours: number; home?: string; now?: Date }): ExperimentCapability {
  if (!(args.budgetUsd > 0) || args.budgetUsd > EXPERIMENT_CAPS[args.phase]) {
    throw new Error(`--budget must be positive and at most $${EXPERIMENT_CAPS[args.phase]} for ${args.phase}`);
  }
  if (!(args.hours > 0) || args.hours > 72) throw new Error('--hours must be between 0 and 72');
  const dir = experimentDir(args.stackId, args.home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const lock = join(dir, '..', 'authorize.lock');
  try {
    writeExclusive(lock, `${process.pid}\n`);
  } catch {
    throw new Error(`Another authorize holds ${lock} (or it was left behind): nothing was authorized; remove it by hand only when no authorize runs`);
  }
  try {
    return writeCapabilityLocked(args, dir);
  } finally {
    rmSync(lock, { force: true });
  }
}

function writeCapabilityLocked(args: { stackId: string; phase: Phase; budgetUsd: number; hours: number; home?: string; now?: Date }, dir: string): ExperimentCapability {
  const others = otherLiveCapabilities(args.stackId, args.home);
  if (others.length > 0) throw new Error(`Another stack holds a live capability (${others.join(', ')}): its spend is in no ledger yet; nothing was authorized`);
  const token = randomBytes(32).toString('hex');
  const now = args.now ?? new Date();
  const capability: ExperimentCapability = {
    version: 1,
    stack_id: args.stackId,
    phase: args.phase,
    gate: PHASE_GATE[args.phase],
    budget_usd: args.budgetUsd,
    expires_at: new Date(now.getTime() + args.hours * 3_600_000).toISOString(),
    token_sha256: sha256(token),
    authorized_at: now.toISOString(),
  };
  const capPath = join(dir, 'capability.json');
  const tokPath = tokenFile(args.stackId, args.home);
  try {
    writeExclusive(capPath, `${JSON.stringify(capability, null, 2)}\n`);
  } catch {
    throw new Error(`${capPath} already exists (or is a symlink): a capability is never replaced; revoke it and investigate`);
  }
  try {
    writeExclusive(tokPath, token);
  } catch {
    rmSync(capPath, { force: true }); // the token was not written: the capability must not stay usable
    throw new Error(`${tokPath} already exists (or is a symlink): keep the old token first (guide, X2 step 4); nothing was authorized`);
  }
  return capability;
}

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

const fixtureFor = (experiment: string) => EXPERIMENT_FIXTURES.find((f) => f.number === EXPERIMENT_FIXTURE[experiment])!;

/** Free preview per experiment: the non-Skill fingerprint the manifest freezes. */
async function previewFingerprints(stack: Stack, reservationUsd: number): Promise<Record<string, string>> {
  const { prId, agents } = await lookupIds(stack.api);
  const out: Record<string, string> = {};
  for (const experiment of Object.keys(EXPERIMENT_FIXTURE)) {
    const fixture = fixtureFor(experiment);
    const preview = await stack.api.post<{ ok: boolean; reason: string | null; block: { non_skill_fingerprint: string | null } }>('/experiments/preview', {
      pr_id: prId(fixture.number),
      agent_id: agents.find((a) => a.name === fixture.reviewer)!.id,
      experiment,
      condition: 'without',
      phase: 'confirmatory',
      reservation_usd: reservationUsd,
      expected_diff_sha256: await fixtureDiffSha(fixture),
    });
    if (!preview.ok || !preview.block.non_skill_fingerprint) throw new Error(`Preview of experiment ${experiment} refused: ${preview.reason}`);
    out[experiment] = preview.block.non_skill_fingerprint;
  }
  return out;
}

/** The Skill fingerprint of a prompt with no Skills (`requestFingerprints` hashes the empty list). */
export const EMPTY_SKILL_FINGERPRINT = sha256(canonicalJson([]));

/**
 * The Skill fingerprint a slot of `condition` must carry: the target skill's
 * prompt block alone, or no Skills. The same value the report expects.
 */
export function expectedSkillFingerprint(condition: 'with' | 'without', target: { name: string; body: string }): string {
  return sha256(canonicalJson(condition === 'with' ? [toSkillPromptBlock(target)] : []));
}

export interface ConditionPreview {
  ok: boolean;
  problems: string[];
  experiment: string;
  condition: 'with' | 'without';
  reviewer: string;
  target_skill: string;
  linked_skills: string[];
  refusal_reason: string | null;
  input_upper_bound: number | null;
  output_cap: number | null;
  price_input_per_token: number | null;
  price_output_per_token: number | null;
  price_source: string | null;
  worst_case_usd: number | null;
  reservation_usd: number;
  non_skill_fingerprint: string | null;
  skill_fingerprint: string | null;
  expected_skill_fingerprint: string;
}

/**
 * A free preview that reflects its condition: the preview API builds the
 * prompt from the reviewer's current links (its `condition` is only a label),
 * so this links exactly what a slot of that condition links (the target skill,
 * or none, as in `slotRuns`), previews, checks that the links and the Skill
 * fingerprint match the condition, and always restores the original links.
 */
export async function conditionPreview(
  api: ExperimentApi,
  args: { experiment: string; condition: string; reservationUsd: number; phase?: Phase },
): Promise<ConditionPreview> {
  if (args.condition !== 'with' && args.condition !== 'without') throw new Error('--condition must be with or without');
  if (!(args.experiment in EXPERIMENT_FIXTURE)) throw new Error(`--experiment must be one of ${Object.keys(EXPERIMENT_FIXTURE).join(', ')}`);
  const condition = args.condition;
  const fixture = fixtureFor(args.experiment);
  const { prId, agents, skills } = await lookupIds(api);
  const agent = agents.find((a) => a.name === fixture.reviewer);
  const target = skills.find((s) => s.name === fixture.targetSkill);
  const pr = prId(fixture.number);
  if (!agent || !target || !pr) throw new Error(`Experiment ${args.experiment}: reviewer, target skill or PR missing`);
  const intended = condition === 'with' ? [target.id] : [];
  const linksOf = async () => (await api.get<Array<{ skill_id: string }>>(`/agents/${agent.id}/skills`)).map((l) => l.skill_id);
  const nameOf = (id: string) => skills.find((s) => s.id === id)?.name ?? id;

  const original = await linksOf();
  try {
    await api.post(`/agents/${agent.id}/skills`, { skill_ids: intended });
    const linked = await linksOf();
    const preview = await api.post<{
      ok: boolean;
      reason: string | null;
      block: {
        non_skill_fingerprint: string | null;
        skill_fingerprint: string | null;
        preflight: {
          input_upper_bound: number;
          output_cap: number;
          price_input_per_token: number;
          price_output_per_token: number;
          price_source: string;
          worst_case_usd: number;
        } | null;
      };
    }>('/experiments/preview', {
      pr_id: pr,
      agent_id: agent.id,
      experiment: args.experiment,
      condition,
      phase: args.phase ?? 'exploration',
      reservation_usd: args.reservationUsd,
      expected_diff_sha256: await fixtureDiffSha(fixture),
    });
    const skillFingerprint = preview.block.skill_fingerprint;
    const problems: string[] = [];
    if (!preview.ok) problems.push(`the preview was refused: ${preview.reason}`);
    if (linked.join(',') !== intended.join(',')) {
      problems.push(`linked skills are [${linked.map(nameOf).join(', ')}], expected [${intended.map(nameOf).join(', ')}]`);
    }
    const expectedSkill = expectedSkillFingerprint(condition, target);
    if (skillFingerprint !== expectedSkill) {
      problems.push(condition === 'without' ? 'a without preview carried a Skill' : `the Skill fingerprint is not that of ${target.name} alone`);
    }
    const flight = preview.block.preflight;
    return {
      ok: problems.length === 0,
      problems,
      experiment: args.experiment,
      condition,
      reviewer: fixture.reviewer,
      target_skill: target.name,
      linked_skills: linked.map(nameOf),
      refusal_reason: preview.reason,
      input_upper_bound: flight?.input_upper_bound ?? null,
      output_cap: flight?.output_cap ?? null,
      price_input_per_token: flight?.price_input_per_token ?? null,
      price_output_per_token: flight?.price_output_per_token ?? null,
      price_source: flight?.price_source ?? null,
      worst_case_usd: flight?.worst_case_usd ?? null,
      reservation_usd: args.reservationUsd,
      non_skill_fingerprint: preview.block.non_skill_fingerprint,
      skill_fingerprint: skillFingerprint,
      expected_skill_fingerprint: expectedSkill,
    };
  } finally {
    await api.post(`/agents/${agent.id}/skills`, { skill_ids: original });
    const restored = await linksOf();
    if (restored.join(',') !== original.join(',')) {
      throw new Error(`Could not restore ${fixture.reviewer}'s links: now [${restored.map(nameOf).join(', ')}]`);
    }
  }
}

/** The four Phase 0 previews, by saved file name (`<experiment>-<condition>.json`). */
export const PHASE0_PAIRS = ['18-with', '18-without', '17-with', '17-without'] as const;

const FINGERPRINT = /^[0-9a-f]{64}$/;

/**
 * Phase 0 over the four saved condition previews. Each must be ok at the
 * approved reservation and output cap, link exactly what its condition links,
 * and carry the Skill fingerprint recomputed here from the current target
 * skill (never taken from the preview). Within each experiment the non-Skill
 * fingerprint must be equal across `with` and `without`. The reservation must
 * cover 1.2 × the largest worst case. Returns the problems; empty means pass.
 */
export function phase0Problems(
  previews: Partial<Record<string, ConditionPreview>>,
  expected: { reservationUsd: number; outputCap: number; targets: Partial<Record<string, { name: string; body: string }>> },
): string[] {
  const problems: string[] = [];
  const worst: number[] = [];
  for (const pair of PHASE0_PAIRS) {
    const [experiment, condition] = pair.split('-') as [string, 'with' | 'without'];
    const fixture = fixtureFor(experiment);
    const p = previews[pair];
    if (!p) {
      problems.push(`${pair}: no saved preview`);
      continue;
    }
    if (p.experiment !== experiment || p.condition !== condition) problems.push(`${pair}: holds the preview of ${p.experiment} / ${p.condition}`);
    if (p.ok !== true || (p.problems ?? []).length > 0) problems.push(`${pair}: not ok: ${(p.problems ?? []).join('; ') || p.refusal_reason}`);
    if (p.reservation_usd !== expected.reservationUsd) problems.push(`${pair}: previewed at reservation ${p.reservation_usd}, not ${expected.reservationUsd}`);
    if (p.output_cap !== expected.outputCap) problems.push(`${pair}: output cap ${p.output_cap}, not ${expected.outputCap}`);
    if (p.reviewer !== fixture.reviewer || p.target_skill !== fixture.targetSkill) {
      problems.push(`${pair}: reviewer ${p.reviewer} / target ${p.target_skill}, expected ${fixture.reviewer} / ${fixture.targetSkill}`);
    }
    const links = condition === 'with' ? [fixture.targetSkill] : [];
    if (JSON.stringify(p.linked_skills) !== JSON.stringify(links)) problems.push(`${pair}: linked skills ${JSON.stringify(p.linked_skills)}, expected ${JSON.stringify(links)}`);
    const target = expected.targets[experiment];
    if (!target || target.name !== fixture.targetSkill) problems.push(`${pair}: target skill ${fixture.targetSkill} not found on the stack`);
    else if (p.skill_fingerprint !== expectedSkillFingerprint(condition, target)) {
      problems.push(`${pair}: Skill fingerprint ${p.skill_fingerprint} is not the expected ${condition === 'with' ? `${target.name} alone` : 'no Skills'}`);
    }
    if (!FINGERPRINT.test(p.non_skill_fingerprint ?? '')) problems.push(`${pair}: no non-Skill fingerprint`);
    if (typeof p.worst_case_usd === 'number' && p.worst_case_usd > 0) worst.push(p.worst_case_usd);
    else problems.push(`${pair}: no worst case`);
  }
  for (const experiment of new Set(PHASE0_PAIRS.map((pair) => pair.split('-')[0]!))) {
    const withP = previews[`${experiment}-with`];
    const withoutP = previews[`${experiment}-without`];
    if (withP && withoutP && withP.non_skill_fingerprint !== withoutP.non_skill_fingerprint) {
      problems.push(`experiment ${experiment}: non-Skill fingerprints differ between with (${withP.non_skill_fingerprint}) and without (${withoutP.non_skill_fingerprint})`);
    }
  }
  if (worst.length > 0 && 1.2 * Math.max(...worst) > expected.reservationUsd + 1e-12) {
    problems.push(`1.2 × the largest worst case ($${(1.2 * Math.max(...worst)).toFixed(6)}) exceeds the reservation $${expected.reservationUsd}`);
  }
  return problems;
}

function readPreview(file: string): ConditionPreview | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ConditionPreview;
  } catch {
    return undefined;
  }
}

async function currentManifest(flags: Flags, stack: Stack, root: string): Promise<Manifest> {
  const { agents, skills } = await lookupIds(stack.api);
  const seed = Number(need(flags, 'seed'));
  const reservation = Number(need(flags, 'reservation'));
  const slots = buildSchedule({ seed, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 });
  const rules = JSON.parse(readFileSync(need(flags, 'rules'), 'utf8')) as Record<string, ExpectedRule>;
  const reviewers = EXPERIMENT_FIXTURES.map((f) => f.reviewer);
  const targets = EXPERIMENT_FIXTURES.map((f) => f.targetSkill);
  const identity = stack.identity as StackIdentity & { prices: unknown; generation_lookup: unknown };
  return buildManifest({
    implementationFingerprint: implementationFingerprint(root).sha256,
    nonSkillFingerprints: await previewFingerprints(stack, reservation),
    stack: {
      database: identity.database,
      provider: identity.provider,
      providerName: identity.provider_name,
      model: identity.model,
      servedModel: identity.served_model ?? null,
      maxOutputTokens: identity.max_output_tokens,
      prices: identity.prices,
      generationLookup: identity.generation_lookup,
    },
    skills: skills.filter((s) => targets.includes(s.name)).map((s) => ({ name: s.name, body: s.body })),
    agents: agents.filter((a) => reviewers.includes(a.name)),
    schedule: { seed, slots },
    rules,
    perSlotReservationUsd: reservation,
  });
}

async function slotRuns(stack: Stack, slots: Slot[], frozen: Manifest | null, reservationUsd: number, fingerprint: string): Promise<SlotRun[]> {
  const { prId, agents, skills } = await lookupIds(stack.api);
  return Promise.all(
    slots.map(async (slot) => {
      const fixture = fixtureFor(slot.experiment);
      const agent = agents.find((a) => a.name === fixture.reviewer);
      const target = skills.find((s) => s.name === fixture.targetSkill);
      const pr = prId(fixture.number);
      if (!agent || !target || !pr) throw new Error(`Experiment ${slot.experiment}: reviewer, target skill or PR missing`);
      return {
        slot,
        prId: pr,
        agentId: agent.id,
        skillIds: slot.condition === 'with' ? [target.id] : [],
        manifestFingerprint: fingerprint,
        expectedDiffSha256: frozen?.fixtures.find((f) => f.number === fixture.number)?.diff_sha256 ?? (await fixtureDiffSha(fixture)),
        reservationUsd,
        expectedNonSkillFingerprint: frozen ? frozen.non_skill_fingerprints[slot.experiment]! : null,
      };
    }),
  );
}

export async function main(argv: string[], log: (m: string) => void = console.log): Promise<void> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case 'endpoints': {
      log(JSON.stringify(await new ExperimentApi(need(flags, 'api')).get('/experiments/endpoints'), null, 2));
      return;
    }
    case 'preview': {
      const stack = await verifiedStack(flags);
      const result = await conditionPreview(stack.api, {
        experiment: need(flags, 'experiment'),
        condition: need(flags, 'condition'),
        reservationUsd: Number(need(flags, 'reservation')),
        ...(flags.phase === 'confirmatory' ? { phase: 'confirmatory' as const } : {}),
      });
      log(JSON.stringify(result, null, 2));
      if (!result.ok) throw new Error(`Preview does not reflect its condition or was refused: ${result.problems.join('; ')}`);
      return;
    }
    case 'phase0-check': {
      const stack = await verifiedStack(flags);
      const dir = need(flags, 'dir');
      const { skills } = await lookupIds(stack.api);
      const targets = Object.fromEntries(
        Object.keys(EXPERIMENT_FIXTURE).map((experiment) => [experiment, skills.find((s) => s.name === fixtureFor(experiment).targetSkill)]),
      );
      const previews = Object.fromEntries(PHASE0_PAIRS.map((pair) => [pair, readPreview(join(dir, `${pair}.json`))]));
      const reservationUsd = Number(need(flags, 'reservation'));
      const problems = phase0Problems(previews, { reservationUsd, outputCap: Number(need(flags, 'cap')), targets });
      for (const pair of PHASE0_PAIRS) {
        const p = previews[pair];
        log(`${pair}: skills [${p?.linked_skills?.join(', ') ?? '?'}], input bound ${p?.input_upper_bound ?? '?'}, worst case $${p?.worst_case_usd ?? '?'}, non-Skill ${p?.non_skill_fingerprint?.slice(0, 12) ?? '?'}…`);
      }
      if (problems.length > 0) throw new Error(`Phase 0 previews failed:\n- ${problems.join('\n- ')}`);
      log(`Phase 0 previews pass on ${stack.stackId}: Skill fingerprints as expected, non-Skill fingerprints equal per experiment, reservation $${reservationUsd} covers 1.2 × the worst case`);
      return;
    }
    case 'check': {
      const stack = await verifiedStack(flags);
      const { prId } = await lookupIds(stack.api);
      for (const fixture of EXPERIMENT_FIXTURES) {
        if (!prId(fixture.number)) throw new Error(`PR #${fixture.number}: fixture PR is not seeded`);
        log(`PR #${fixture.number}: seeded; frozen diff sha256 ${await fixtureDiffSha(fixture)}`);
      }
      log(`implementation fingerprint ${implementationFingerprint(repoRoot()).sha256}`);
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
      const manifest = await currentManifest(flags, stack, repoRoot());
      if (!scheduleFits(manifest.schedule.slots.length, manifest.per_slot_reservation_usd)) {
        throw new Error(`${manifest.schedule.slots.length} slots × $${manifest.per_slot_reservation_usd} exceed the $${CAPS.confirmatory} confirmatory cap`);
      }
      const json = JSON.stringify(manifest, null, 2);
      if (typeof flags.out === 'string') writeFileSync(flags.out, `${json}\n`);
      log(`manifest fingerprint ${manifestFingerprint(manifest)}`);
      return;
    }
    case 'authorize': {
      const phase = assertPaidAuthorization(flags);
      const stack = await verifiedStack(flags);
      const capability = writeCapability({ stackId: stack.stackId, phase, budgetUsd: Number(need(flags, 'budget')), hours: Number(flags.hours ?? 12) });
      log(`capability for ${phase} (Gate ${capability.gate}) on ${stack.stackId}: budget $${capability.budget_usd}, expires ${capability.expires_at}`);
      return;
    }
    case 'reconcile': {
      const stack = await verifiedStack(flags);
      const ledger = new Ledger(experimentDir(stack.stackId));
      ledger.acquire({ pid: process.pid, stackId: stack.stackId });
      try {
        await reconcile({ api: stack.api, ledger, log, capabilityToken: '' });
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
      if (!existsSync(tokenFile(stack.stackId))) throw new Error(`No spending capability for ${stack.stackId}; run \`authorize\` after the gate is authorized`);
      const capabilityToken = readFileSync(tokenFile(stack.stackId), 'utf8').trim();
      const ledger = new Ledger(experimentDir(stack.stackId));
      ledger.acquire({ pid: process.pid, stackId: stack.stackId });
      try {
        const deps = { api: stack.api, ledger, log, capabilityToken };
        await reconcile(deps);
        let runs: SlotRun[];
        if (phase === 'confirmatory') {
          const root = repoRoot();
          const frozen = preregisteredManifest<Manifest>(need(flags, 'prereg'), root);
          const current = await currentManifest({ ...flags, seed: String(frozen.schedule.seed), reservation: String(frozen.per_slot_reservation_usd) }, stack, root);
          if (manifestFingerprint(current) !== manifestFingerprint(frozen)) {
            throw new Error('The current implementation, stack or content does not match the pre-registered manifest');
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
        const { stopped } = await runSchedule(deps, runs);
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
      const root = repoRoot();
      const frozen = preregisteredManifest<Manifest>(need(flags, 'prereg'), root);
      if (!frozen.stack.providerName) throw new Error('The pre-registration has no frozen serving-provider name');
      if (!frozen.stack.servedModel) throw new Error('The pre-registration has no frozen served model');
      const ledger = new Ledger(experimentDir(stack.stackId));
      const { prId } = await lookupIds(stack.api);
      const runs = new Map<string, SlotRunData | null>();
      for (const slot of frozen.schedule.slots) {
        const lookup = await stack.api.get<{
          runs: Array<{
            run_id: string;
            cost_usd: number | null;
            experiment: Record<string, unknown> | null;
            config: { agent?: string; pr?: number | null } | null;
            skills_block: string | null;
          }>;
        }>(`/experiments/slots/${slot.slot_id}`);
        const found = lookup.runs[0];
        if (!found?.experiment) {
          runs.set(slot.slot_id, null);
          continue;
        }
        const reviews = await stack.api.get<Array<{ run_id: string | null; findings: FindingLike[] }>>(`/pulls/${prId(fixtureFor(slot.experiment).number)}/reviews`);
        runs.set(slot.slot_id, {
          run_id: found.run_id,
          cost_usd: found.cost_usd,
          experiment: found.experiment,
          config: found.config,
          skills_block: found.skills_block,
          findings: reviews.find((r) => r.run_id === found.run_id)?.findings ?? [],
        });
      }
      // The target skills as frozen: their current bodies must still hash to the manifest's.
      const { skills } = await lookupIds(stack.api);
      const targetBlock = (experiment: string) => {
        const name = fixtureFor(experiment).targetSkill;
        const skill = skills.find((s) => s.name === name);
        const frozenSha = frozen.skills.find((s) => s.name === name)?.body_sha;
        if (!skill || !frozenSha || sha256(skill.body) !== frozenSha) throw new Error(`Target skill ${name} is missing or differs from the manifest`);
        return toSkillPromptBlock(skill);
      };
      const report = buildReport({
        execution: {
          manifestFingerprint: manifestFingerprint(frozen),
          phase: 'confirmatory',
          fixture: (experiment) => {
            const fixture = fixtureFor(experiment);
            return { reviewer: fixture.reviewer, prNumber: fixture.number, targetSkill: fixture.targetSkill };
          },
          skillFingerprint: (experiment, condition) => sha256(canonicalJson(condition === 'with' ? [targetBlock(experiment)] : [])),
        },
        schedule: frozen.schedule.slots,
        ledger: ledger.slots(),
        runs,
        rules: frozen.rules,
        frozenNonSkill: frozen.non_skill_fingerprints,
        expectations: (experiment) => {
          const fixture = fixtureFor(experiment);
          return {
            providerName: frozen.stack.providerName!,
            model: frozen.stack.model,
            servedModel: frozen.stack.servedModel!,
            expectedDiffSha256: frozen.fixtures.find((f) => f.number === fixture.number)!.diff_sha256,
          };
        },
      });
      const markdown = renderReport(report);
      if (typeof flags.out === 'string') writeFileSync(flags.out, `${markdown}\n`);
      log(markdown);
      return;
    }
    default:
      log('commands: endpoints | check | preview | phase0-check | plan | manifest | authorize | reconcile | run | report (see docs/plans/HW2-experiment-operator-guide.md)');
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`hw2-experiments: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
