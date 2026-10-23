import { EXPERIMENT_FIXTURES, patchStats, type ExperimentFixture } from '../../db/seed-fixtures.js';
import { diffFromPrFiles } from '../../modules/reviews/diff-loader.js';
import type { ReviewRepository } from '../../modules/reviews/repository.js';
import { canonicalJson, sha256 } from '../../modules/_shared/experiment.js';
import type { ExpectedRule } from './rules.js';
import type { Slot } from './schedule.js';

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
  skills: Array<{ name: string; body: string }>;
  agents: Array<{ name: string; system_prompt: string; model: string; strategy: string; repo_intel: boolean }>;
  schedule: { seed: number; slots: Slot[] };
  rules: Record<string, ExpectedRule>;
  perSlotReservationUsd: number;
}

/** The canonical, hashable description of everything a confirmatory run holds fixed. */
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
    version: 2,
    implementation_fingerprint: input.implementationFingerprint,
    non_skill_fingerprints: input.nonSkillFingerprints,
    stack: input.stack,
    retry: { transport: 0, structured: 0 },
    temperature: 0,
    fixtures,
    skills: input.skills.map((skill) => ({ name: skill.name, body_sha: sha256(skill.body) })),
    agents: input.agents.map((agent) => ({
      name: agent.name,
      system_prompt_sha: sha256(agent.system_prompt),
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
