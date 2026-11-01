import { EXPERIMENT_FIXTURES, patchStats, type ExperimentFixture } from '../../db/seed-fixtures.js';
import { diffFromPrFiles } from '../../modules/reviews/diff-loader.js';
import type { ReviewRepository } from '../../modules/reviews/repository.js';
import { canonicalJson, sha256 } from '../../modules/_shared/experiment.js';
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
  adjudication_packet: 2,
  redaction: 'r1',
};

/** The studies a version 4 manifest may name. */
const KNOWN_STUDIES: Record<string, StudyBlock> = { [STUDY_V4.id]: STUDY_V4 };

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

export type Manifest = ManifestV3 | ManifestV4;

/** What a frozen manifest's version means for the runner, the report and the adjudication. */
export interface StudySemantics {
  version: 3 | 4;
  /** null: untagged v3 slot IDs. */
  slotTag: string | null;
  experiments: string[];
  perCondition: number;
  truncation: 'stop' | 'continue-impute';
  adjudicationPacket: 1 | 2;
  redaction: 'none' | 'r1';
}

/** The closed v3 study: 17 and 18, five per condition, any truncation stops the schedule, packet v1 unredacted. */
export const V3_SEMANTICS: StudySemantics = Object.freeze({
  version: 3,
  slotTag: null,
  experiments: ['17', '18'],
  perCondition: 5,
  truncation: 'stop',
  adjudicationPacket: 1,
  redaction: 'none',
}) as StudySemantics;

/** The semantics of a manifest version. Throws on any version or study this runner does not know. */
export function studySemantics(manifest: { version: unknown; study?: unknown }): StudySemantics {
  if (manifest.version === 3) return V3_SEMANTICS;
  if (manifest.version === 4) {
    const study = knownStudy(manifest.study);
    return {
      version: 4,
      slotTag: study.slot_tag,
      experiments: [...study.experiments],
      perCondition: study.per_condition,
      truncation: study.truncation,
      adjudicationPacket: study.adjudication_packet,
      redaction: study.redaction,
    };
  }
  throw new Error(`The pre-registration is manifest version ${String(manifest.version)}; this runner freezes versions 3 and 4`);
}

function knownStudy(study: unknown): StudyBlock {
  const id = (study as { id?: unknown } | null | undefined)?.id;
  const known = typeof id === 'string' ? KNOWN_STUDIES[id] : undefined;
  if (!known || canonicalJson(known) !== canonicalJson(study)) {
    throw new Error(`A version 4 manifest must carry a known study block exactly (got ${canonicalJson(study ?? null)})`);
  }
  return known;
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
  const study = knownStudy(input.study);
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
    version: 4 as const,
    study,
    fixtures: base.fixtures.filter((f) => fixtures.some((x) => x.number === f.number)),
  } as Omit<ManifestV4, 'schedule'>;
  const basis = sha256(canonicalJson(body));
  const seed = deriveSeed(study.id, basis);
  const slots = scheduleFor(studySemantics(body), seed).map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition }));
  return { ...body, schedule: { seed, seed_derivation: { method: SEED_METHOD, basis_fingerprint: basis }, slots } };
}

/** Why a version 4 manifest's seed or schedule is not the one its content derives (empty when it is). */
export function seedProblems(manifest: ManifestV4): string[] {
  const problems: string[] = [];
  const basis = sha256(canonicalJson(withoutSchedule(manifest as unknown as Record<string, unknown>)));
  const derivation = manifest.schedule?.seed_derivation;
  if (derivation?.method !== SEED_METHOD) problems.push('the seed derivation method is not the frozen one');
  if (derivation?.basis_fingerprint !== basis) problems.push('the seed basis is not the fingerprint of the manifest without its schedule');
  if (manifest.schedule?.seed !== deriveSeed(manifest.study.id, basis)) problems.push('the seed is not the one its basis derives');
  const expected = scheduleFor(studySemantics(manifest), deriveSeed(manifest.study.id, basis)).map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition }));
  if (canonicalJson(manifest.schedule?.slots ?? null) !== canonicalJson(expected)) problems.push('the schedule is not the one the derived seed builds');
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
 * builds: version 3 as before, or version 4 with a known study block and the
 * seed and schedule its content derives.
 */
export function readFrozen(file: string, root: string): Manifest {
  const frozen = preregisteredManifest<Manifest>(file, root);
  studySemantics(frozen);
  if (frozen.version === 4) {
    const problems = seedProblems(frozen);
    if (problems.length > 0) throw new Error(`The version 4 pre-registration is inconsistent: ${problems.join('; ')}`);
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
