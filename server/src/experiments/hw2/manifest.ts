import { EXPERIMENT_FIXTURES, patchStats, type ExperimentFixture } from '../../db/seed-fixtures.js';
import { diffFromPrFiles } from '../../modules/reviews/diff-loader.js';
import type { ReviewRepository } from '../../modules/reviews/repository.js';
import { canonicalJson, sha256 } from '../../modules/_shared/experiment.js';
import type { ExpectedRule } from './rules.js';
import type { Slot } from './schedule.js';
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
    version: 3,
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

export type Manifest = Awaited<ReturnType<typeof buildManifest>>;

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

/** A committed, unmodified pre-registration of the manifest version this runner builds. */
export function readFrozen(file: string, root: string): Manifest {
  const frozen = preregisteredManifest<Manifest>(file, root);
  if (frozen.version !== 3) throw new Error(`The pre-registration is manifest version ${String(frozen.version)}; this runner freezes version 3`);
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
