import { EXPERIMENT_FIXTURES, patchStats, type ExperimentFixture } from '../../db/seed-fixtures.js';
import { diffFromPrFiles } from '../../modules/reviews/diff-loader.js';
import type { ReviewRepository } from '../../modules/reviews/repository.js';
import { canonicalJson, sha256 } from '../../modules/_shared/experiment.js';
import { P3_ATTEMPT_POLICY_V5, attemptPlan, frozenAttempts, type AttemptPolicyP3, type FrozenAttempt } from './attempt-policy.js';
import type { TruncationProvenancePolicy } from './eligibility.js';
import type { ExpectedRule } from './rules.js';
import { buildSchedule, type Slot } from './schedule.js';
import { preregisteredManifest } from './source.js';

/** Fixture number per experiment (criterion 17: Test Quality, 18: API Contract). */
export const EXPERIMENT_FIXTURE: Record<string, number> = { '17': 501, '18': 502 };

/** sha256 of the diff a review of this fixture loads from its stored patches (the frozen hash). */
export async function fixtureDiffSha(fixture: ExperimentFixture): Promise<string> {
  const stub = { getPrFiles: async () => fixture.files.map((f) => ({ ...f, ...patchStats(f.patch) })) } as unknown as ReviewRepository;
  return sha256((await diffFromPrFiles(stub, 'fixture')).raw);
}

export interface ManifestInput {
  /** implementationFingerprint(): independent of the pre-registration commit. */
  implementationFingerprint: string;
  /** Per experiment, the non-Skill fingerprint from the free preview; every counted slot must reproduce it. */
  nonSkillFingerprints: Record<string, string>;
  stack: { database: string; provider: string; providerName: string | null; model: string; servedModel: string | null; maxOutputTokens: number; prices: unknown; generationLookup: unknown };
  skills: Array<{ id: string; name: string; body: string; enabled: boolean; approval?: SkillApprovalState | null }>;
  agents: Array<{ id: string; name: string; enabled: boolean; provider: string; system_prompt: string; output_schema: unknown; model: string; strategy: string; repo_intel: boolean }>;
  schedule: { seed: number; slots: Slot[] };
  rules: Record<string, ExpectedRule>;
  perSlotReservationUsd: number;
}

/**
 * The approval a Skill carries in the `/skills` listing. `approved` means the
 * latest decision approves exactly the current version and body digest, so
 * with `body_sha` it freezes the approved digest.
 */
export interface SkillApprovalState {
  status: string;
  approved_version: number | null;
}

/**
 * The one record named `name`. Names are not unique in the database, and the
 * runner looks records up by name, so a duplicate would let row order pick
 * which one a slot uses without changing the fingerprint: refuse it.
 */
export function exactlyOne<T extends { name: string }>(records: readonly T[], name: string, kind: string): T {
  const found = records.filter((r) => r.name === name);
  if (found.length !== 1) throw new Error(`Expected exactly one ${kind} named "${name}", found ${found.length}`);
  return found[0]!;
}

/**
 * Name, then ID: a stable order for records the API lists in database row
 * order, which an unrelated update can change. Sorts a copy; the input, and
 * so the persisted Skill link order a prompt uses, is never touched.
 */
export function byNameThenId<T extends { name: string; id: string }>(records: readonly T[]): T[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...records].sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id));
}

/**
 * The canonical, hashable description of everything a confirmatory run holds
 * fixed. Sets without a meaningful order (agents, Skills) are sorted, so only
 * a change of content changes the fingerprint; the schedule keeps its
 * randomized order.
 */
export async function buildManifest(input: ManifestInput) {
  const fixtures = await Promise.all(
    EXPERIMENT_FIXTURES.map(async (fixture) => ({
      number: fixture.number,
      reviewer: fixture.reviewer,
      target_skill: fixture.targetSkill,
      title: fixture.title,
      body_sha: sha256(fixture.body),
      files: fixture.files.map((file) => ({ path: file.path, patch_sha: sha256(file.patch) })),
      diff_sha256: await fixtureDiffSha(fixture),
      expected_anchors: fixture.expectedAnchors,
    })),
  );
  return {
    version: 3 as const,
    implementation_fingerprint: input.implementationFingerprint,
    non_skill_fingerprints: input.nonSkillFingerprints,
    stack: input.stack,
    retry: { transport: 0, structured: 0 },
    temperature: 0,
    fixtures,
    skills: byNameThenId(input.skills).map((skill) => ({
      name: skill.name,
      body_sha: sha256(skill.body),
      enabled: skill.enabled,
      approval: { status: skill.approval?.status ?? 'unapproved', approved_version: skill.approval?.approved_version ?? null },
    })),
    agents: byNameThenId(input.agents).map((agent) => ({
      name: agent.name,
      enabled: agent.enabled,
      system_prompt_sha: sha256(agent.system_prompt),
      output_schema_sha: sha256(canonicalJson(agent.output_schema ?? null)),
      provider: agent.provider,
      model: agent.model,
      strategy: agent.strategy,
      repo_intel: agent.repo_intel,
    })),
    schedule: {
      seed: input.schedule.seed,
      slots: input.schedule.slots.map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition })),
    },
    rules: input.rules,
    per_slot_reservation_usd: input.perSlotReservationUsd,
  };
}

/** The closed v3 study's manifest, exactly as `buildManifest` writes it. */
export type ManifestV3 = Awaited<ReturnType<typeof buildManifest>>;

/**
 * A successor study, frozen in a version 4 manifest. Each field selects a
 * behaviour the runner, the report and the adjudication take from the frozen
 * manifest, never from a command-line flag.
 */
export interface StudyBlock {
  id: string;
  /** Slot IDs are `c-<slot_tag>-<experiment>-<condition>-<trial>`. */
  slot_tag: string;
  experiments: string[];
  per_condition: number;
  /** `continue-impute`: a truncated slot is terminal, not retried, does not stop the schedule, and is imputed against the hypothesis. */
  truncation: 'continue-impute';
  /**
   * `single-router-attempt`: a truncation also continues on router metadata
   * alone (attempt 1 on the frozen endpoint, generation `not_found` or one
   * matching response); see `truncationCheck`.
   */
  truncation_provenance: 'single-router-attempt';
  /** Blind packet and mapping version 2 (redacted, with private originals). */
  adjudication_packet: 2;
  redaction: 'r1';
}

/** The item B successor study for criterion 17 only (2026-11-01). */
export const STUDY_V4: StudyBlock = {
  id: 'itemb-v4',
  slot_tag: 'v4',
  experiments: ['17'],
  per_condition: 5,
  truncation: 'continue-impute',
  truncation_provenance: 'single-router-attempt',
  adjudication_packet: 2,
  redaction: 'r1',
};

/**
 * Study v5 (2026-11-02): the v4 design for #17 plus the owner-approved P3
 * attempt pool, P4 reporting and no warm-ups, frozen in a version 5 manifest.
 * Its trials keep v4's slot-ID form with the `v5` tag; only attempt IDs
 * (`<trial>-a<k>`) are ever dispatched.
 */
export interface StudyBlockV5 extends StudyBlock {
  attempt_policy: AttemptPolicyP3;
  /** `p4`: observed results apart from worst- and best-case bounds over the trials lost to classified 429s. */
  reporting: 'p4';
  warmups: 0;
}

export const STUDY_V5: StudyBlockV5 = {
  id: 'itemb-v5',
  slot_tag: 'v5',
  experiments: ['17'],
  per_condition: 5,
  truncation: 'continue-impute',
  truncation_provenance: 'single-router-attempt',
  adjudication_packet: 2,
  redaction: 'r1',
  attempt_policy: P3_ATTEMPT_POLICY_V5,
  reporting: 'p4',
  warmups: 0,
};

/** The studies each tagged manifest version may name: a version never carries another version's study. */
const KNOWN_STUDIES: Record<4 | 5, Record<string, StudyBlock>> = {
  4: { [STUDY_V4.id]: STUDY_V4 },
  5: { [STUDY_V5.id]: STUDY_V5 },
};

export interface SeedDerivation {
  method: string;
  /** The fingerprint of this manifest with its `schedule` left out. */
  basis_fingerprint: string;
}

export type ManifestV4 = Omit<ManifestV3, 'version' | 'schedule'> & {
  version: 4;
  study: StudyBlock;
  schedule: ManifestV3['schedule'] & { seed_derivation: SeedDerivation };
};

export type ManifestV5 = Omit<ManifestV4, 'version' | 'study' | 'schedule'> & {
  version: 5;
  study: StudyBlockV5;
  /** `slots` are the trials; `attempts` every attempt ID the policy may use, in plan order. */
  schedule: ManifestV4['schedule'] & { attempts: FrozenAttempt[] };
};

export type Manifest = ManifestV3 | ManifestV4 | ManifestV5;

/** A manifest of a tagged successor study (version 4 or 5): seed derived from its content. */
export type TaggedManifest = ManifestV4 | ManifestV5;
export const isTagged = (manifest: Manifest): manifest is TaggedManifest => manifest.version === 4 || manifest.version === 5;

/** What a frozen manifest's version means for the runner, the report and the adjudication. */
export interface StudySemantics {
  version: 3 | 4 | 5;
  /** null: untagged v3 slot IDs. */
  slotTag: string | null;
  experiments: string[];
  perCondition: number;
  truncation: 'stop' | 'continue-impute';
  /** The provenance a truncation needs to continue (v3: never continues). */
  truncationProvenance: TruncationProvenancePolicy;
  adjudicationPacket: 1 | 2;
  redaction: 'none' | 'r1';
  /** Version 5 only: the frozen attempt pool (absent in versions 3 and 4, which never re-attempt). */
  attemptPolicy?: AttemptPolicyP3;
  /** Version 5 only. */
  reporting?: 'p4';
}

/** The closed v3 study: 17 and 18, five per condition, any truncation stops the schedule, packet v1 unredacted. */
export const V3_SEMANTICS: StudySemantics = Object.freeze({
  version: 3,
  slotTag: null,
  experiments: ['17', '18'],
  perCondition: 5,
  truncation: 'stop',
  truncationProvenance: 'strict',
  adjudicationPacket: 1,
  redaction: 'none',
}) as StudySemantics;

/** The semantics of a manifest version. Throws on any version or study this runner does not know. */
export function studySemantics(manifest: { version: unknown; study?: unknown }): StudySemantics {
  if (manifest.version === 3) return V3_SEMANTICS;
  if (manifest.version === 4 || manifest.version === 5) {
    const version = manifest.version;
    const study = knownStudy(manifest.study, version);
    const base: StudySemantics = {
      version,
      slotTag: study.slot_tag,
      experiments: [...study.experiments],
      perCondition: study.per_condition,
      truncation: study.truncation,
      truncationProvenance: study.truncation_provenance,
      adjudicationPacket: study.adjudication_packet,
      redaction: study.redaction,
    };
    if (version === 4) return base;
    const v5 = study as StudyBlockV5;
    return { ...base, attemptPolicy: v5.attempt_policy, reporting: v5.reporting };
  }
  throw new Error(`The pre-registration is manifest version ${String(manifest.version)}; this runner freezes versions 3, 4 and 5`);
}

function knownStudy(study: unknown, version: 4 | 5 = 4): StudyBlock {
  const id = (study as { id?: unknown } | null | undefined)?.id;
  const known = typeof id === 'string' ? KNOWN_STUDIES[version][id] : undefined;
  if (!known || canonicalJson(known) !== canonicalJson(study)) {
    throw new Error(`A version ${version} manifest must carry a known study block exactly (got ${canonicalJson(study ?? null)})`);
  }
  return known;
}

/** The version a study block is frozen under (4 or 5); throws on an unknown block. */
export function versionOfStudy(study: StudyBlock): 4 | 5 {
  for (const version of [4, 5] as const) if (KNOWN_STUDIES[version][study.id] && canonicalJson(KNOWN_STUDIES[version][study.id]) === canonicalJson(study)) return version;
  throw new Error(`Unknown study block ${canonicalJson(study)}`);
}

/** The slots a frozen manifest's semantics schedule from `seed`, in their randomized order. */
export function scheduleFor(semantics: StudySemantics, seed: number): Slot[] {
  return buildSchedule({
    seed,
    phase: 'confirmatory',
    experiments: semantics.experiments,
    trials: semantics.perCondition,
    ...(semantics.slotTag ? { tag: semantics.slotTag } : {}),
  });
}

export const SEED_METHOD = 'uint32 of the first 8 hex digits of sha256("hw2-" + study.id + "|" + basis_fingerprint)';

/** The v4 seed: derived from everything else the manifest freezes, so nobody picks it. */
export function deriveSeed(studyId: string, basisFingerprint: string): number {
  return Number.parseInt(sha256(`hw2-${studyId}|${basisFingerprint}`).slice(0, 8), 16) >>> 0;
}

const withoutSchedule = (manifest: Record<string, unknown>) => Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'schedule'));

/**
 * A version 4 manifest. Only the study's experiments are frozen: their
 * fixtures, reviewers, target Skills, non-Skill fingerprints and rules (a
 * missing one throws). The seed is derived from the manifest without its
 * schedule, then the tagged schedule is built from it.
 */
export async function buildManifestV4(input: Omit<ManifestInput, 'schedule'> & { study: StudyBlock }): Promise<ManifestV4> {
  return (await buildTagged(input, 4)) as ManifestV4;
}

/**
 * A version 5 manifest: built exactly as version 4 (same frozen content, the
 * seed derived the same way from the study ID and the manifest without its
 * schedule), with the v5 study block, and the full attempt-ID plan frozen
 * next to the trial schedule.
 */
export async function buildManifestV5(input: Omit<ManifestInput, 'schedule'> & { study: StudyBlockV5 }): Promise<ManifestV5> {
  return (await buildTagged(input, 5)) as ManifestV5;
}

async function buildTagged(input: Omit<ManifestInput, 'schedule'> & { study: StudyBlock }, version: 4 | 5): Promise<TaggedManifest> {
  const study = knownStudy(input.study, version);
  const fixtures = study.experiments.map((experiment) => {
    const number = EXPERIMENT_FIXTURE[experiment];
    const fixture = EXPERIMENT_FIXTURES.find((f) => f.number === number);
    if (!fixture) throw new Error(`Experiment ${experiment} has no fixture`);
    return fixture;
  });
  const pick = <T>(record: Record<string, T>, what: string) =>
    Object.fromEntries(study.experiments.map((experiment) => {
      if (!(experiment in record)) throw new Error(`No ${what} for experiment ${experiment}`);
      return [experiment, record[experiment]!];
    }));
  const base = await buildManifest({
    ...input,
    nonSkillFingerprints: pick(input.nonSkillFingerprints, 'non-Skill fingerprint'),
    rules: pick(input.rules, 'rule'),
    skills: input.skills.filter((s) => fixtures.some((f) => f.targetSkill === s.name)),
    agents: input.agents.filter((a) => fixtures.some((f) => f.reviewer === a.name)),
    schedule: { seed: 0, slots: [] },
  });
  for (const fixture of fixtures) {
    if (!base.skills.some((s) => s.name === fixture.targetSkill)) throw new Error(`Target Skill "${fixture.targetSkill}" is missing`);
    if (!base.agents.some((a) => a.name === fixture.reviewer)) throw new Error(`Reviewer "${fixture.reviewer}" is missing`);
  }
  const body = {
    ...withoutSchedule(base),
    version,
    study,
    fixtures: base.fixtures.filter((f) => fixtures.some((x) => x.number === f.number)),
  } as Omit<TaggedManifest, 'schedule'>;
  const basis = sha256(canonicalJson(body));
  const seed = deriveSeed(study.id, basis);
  const semantics = studySemantics(body);
  const trials = scheduleFor(semantics, seed);
  const slots = trials.map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition }));
  const derivation = { method: SEED_METHOD, basis_fingerprint: basis };
  if (version === 4) return { ...(body as Omit<ManifestV4, 'schedule'>), schedule: { seed, seed_derivation: derivation, slots } };
  const attempts = frozenAttempts(attemptPlan(trials, semantics.attemptPolicy!));
  return { ...(body as Omit<ManifestV5, 'schedule'>), schedule: { seed, seed_derivation: derivation, slots, attempts } };
}

/** Why a version 4 or 5 manifest's seed, schedule or attempt plan is not the one its content derives (empty when it is). */
export function seedProblems(manifest: TaggedManifest): string[] {
  const problems: string[] = [];
  const basis = sha256(canonicalJson(withoutSchedule(manifest as unknown as Record<string, unknown>)));
  const derivation = manifest.schedule?.seed_derivation;
  if (derivation?.method !== SEED_METHOD) problems.push('the seed derivation method is not the frozen one');
  if (derivation?.basis_fingerprint !== basis) problems.push('the seed basis is not the fingerprint of the manifest without its schedule');
  if (manifest.schedule?.seed !== deriveSeed(manifest.study.id, basis)) problems.push('the seed is not the one its basis derives');
  const expected = scheduleFor(studySemantics(manifest), deriveSeed(manifest.study.id, basis)).map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition }));
  if (canonicalJson(manifest.schedule?.slots ?? null) !== canonicalJson(expected)) problems.push('the schedule is not the one the derived seed builds');
  if (manifest.version === 5) {
    const semantics = studySemantics(manifest);
    const trials = scheduleFor(semantics, deriveSeed(manifest.study.id, basis));
    const plan = frozenAttempts(attemptPlan(trials, semantics.attemptPolicy!));
    if (canonicalJson(manifest.schedule?.attempts ?? null) !== canonicalJson(plan)) problems.push('the attempt plan is not the one the frozen policy and the derived schedule build');
  }
  return problems;
}

export const manifestFingerprint = (manifest: Manifest) => sha256(canonicalJson(manifest));

/** Top-level manifest fields whose canonical content differs; empty when the fingerprints agree. */
export function manifestDifferences(frozen: Manifest, current: Manifest): string[] {
  if (manifestFingerprint(frozen) === manifestFingerprint(current)) return [];
  const keys = [...new Set([...Object.keys(frozen), ...Object.keys(current)])].sort();
  const differing = keys.filter(
    (key) => canonicalJson((frozen as Record<string, unknown>)[key]) !== canonicalJson((current as Record<string, unknown>)[key]),
  );
  return differing.length > 0 ? differing : ['(fingerprint)'];
}

/**
 * A committed, unmodified pre-registration of a manifest version this runner
 * builds: version 3 as before, or version 4 or 5 with a known study block of
 * that version and the seed and schedule (version 5: and the attempt plan)
 * its content derives.
 */
export function readFrozen(file: string, root: string): Manifest {
  const frozen = preregisteredManifest<Manifest>(file, root);
  studySemantics(frozen);
  if (isTagged(frozen)) {
    const problems = seedProblems(frozen);
    if (problems.length > 0) throw new Error(`The version ${frozen.version} pre-registration is inconsistent: ${problems.join('; ')}`);
  }
  return frozen;
}

/**
 * Why a slot's live target Skill is not the frozen one (empty when it is):
 * checked again when the slots are built, after the manifest comparison.
 */
export function frozenSkillProblems(frozen: Manifest, live: ManifestInput['skills'][number]): string[] {
  const entry = frozen.skills.find((s) => s.name === live.name);
  if (!entry) return [`Skill "${live.name}" is not in the pre-registration`];
  const problems: string[] = [];
  if (sha256(live.body) !== entry.body_sha) problems.push(`Skill "${live.name}" body changed since the freeze`);
  if (live.enabled !== entry.enabled) problems.push(`Skill "${live.name}" enabled changed since the freeze`);
  const status = live.approval?.status ?? 'unapproved';
  const version = live.approval?.approved_version ?? null;
  if (status !== entry.approval.status || version !== entry.approval.approved_version) problems.push(`Skill "${live.name}" approval changed since the freeze`);
  return problems;
}

/**
 * The committed pre-registration, checked against the manifest the stack
 * builds now with the frozen seed and reservation. Throws before anything is
 * authorized or dispatched when the file is missing, uncommitted, malformed or
 * no longer matches.
 */
export async function verifyPreregistration(
  file: string,
  root: string,
  current: (frozen: Manifest) => Promise<Manifest>,
): Promise<{ frozen: Manifest; fingerprint: string }> {
  const frozen = readFrozen(file, root);
  const differing = manifestDifferences(frozen, await current(frozen));
  if (differing.length > 0) {
    throw new Error(`The current implementation, stack or content does not match the pre-registered manifest (differs in: ${differing.join(', ')})`);
  }
  return { frozen, fingerprint: manifestFingerprint(frozen) };
}
