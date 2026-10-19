import { canonicalJson, sha256 } from '../../modules/_shared/experiment.js';

/**
 * Whether one completed slot is strict single-generation evidence. Only
 * OpenRouter's reported metadata counts; the requested routing is intent, not
 * evidence. Anything missing, ambiguous or showing more than one upstream
 * attempt makes the slot ineligible (it stays in the ledger and the report).
 */

export interface FrozenExpectations {
  providerName: string;
  model: string;
  expectedDiffSha256: string;
}

interface Attempt {
  dispatch?: string;
  outcome?: string;
  servedModel?: string | null;
  router?: { selected?: Array<{ provider: string; model: string }>; attempt?: number | null; attemptsCount?: number | null } | null;
  generation?: {
    status?: string;
    providerName?: string | null;
    model?: string | null;
    providerResponses?: Array<{ providerName: string | null }>;
  } | null;
}

export interface Eligibility {
  eligible: boolean;
  provenance: 'verified' | 'unverified';
  /** `router_metadata`, `generation`, or both, that established the provider. */
  sources: string[];
  reasons: string[];
}

export function evaluateSlot(trace: { experiment?: unknown } | null, frozen: FrozenExpectations): Eligibility {
  const reasons: string[] = [];
  const sources: string[] = [];
  const experiment = (trace?.experiment ?? null) as null | {
    dispatch_state?: string;
    diff_sha256?: string | null;
    attempts?: Attempt[];
  };
  if (!experiment) return { eligible: false, provenance: 'unverified', sources, reasons: ['no experiment block'] };
  if (experiment.dispatch_state !== 'completed') reasons.push(`dispatch_state ${experiment.dispatch_state}`);
  if (experiment.diff_sha256 !== frozen.expectedDiffSha256) reasons.push('diff hash differs from the frozen fixture');

  const attempts = experiment.attempts ?? [];
  if (attempts.length !== 1) {
    reasons.push(`expected exactly one attempt, found ${attempts.length}`);
    return { eligible: false, provenance: 'unverified', sources, reasons };
  }
  const attempt = attempts[0]!;
  if (attempt.dispatch !== 'dispatched' || attempt.outcome !== 'valid') reasons.push(`attempt outcome ${attempt.outcome}`);

  // Two separate facts must be shown by OpenRouter's own metadata, never assumed:
  // (1) which provider served the request, (2) that exactly one upstream attempt
  // happened. A missing field proves nothing; any disagreement is unverified.
  const provenanceIssues: string[] = [];
  if (attempt.servedModel !== frozen.model) provenanceIssues.push(`served model ${attempt.servedModel ?? 'unknown'} is not ${frozen.model}`);
  let singleAttemptProven = false;

  // Router metadata: exactly one selected endpoint on the frozen provider;
  // `attempt` and `attempts` must both be present and both say one.
  const router = attempt.router ?? null;
  if (router) {
    const selected = router.selected ?? [];
    const before = provenanceIssues.length;
    if (selected.length !== 1) provenanceIssues.push(`router metadata selected ${selected.length} endpoints`);
    else if (selected[0]!.provider !== frozen.providerName) provenanceIssues.push(`router selected ${selected[0]!.provider}, not ${frozen.providerName}`);
    if (provenanceIssues.length === before) sources.push('router_metadata');
    const attemptNo = router.attempt;
    const attemptsCount = router.attemptsCount;
    if ((typeof attemptNo === 'number' && attemptNo !== 1) || (typeof attemptsCount === 'number' && attemptsCount !== 1)) {
      provenanceIssues.push('router metadata shows more than one upstream attempt');
    } else if (attemptNo === 1 && attemptsCount === 1) {
      singleAttemptProven = true;
    }
  }

  // Generation metadata: corroborates the provider; exactly one provider
  // response proves a single generation, while none (empty or missing) proves nothing.
  const generation = attempt.generation ?? null;
  if (generation?.status === 'found') {
    const before = provenanceIssues.length;
    const responses = generation.providerResponses ?? [];
    if (generation.providerName !== frozen.providerName) provenanceIssues.push(`generation provider ${generation.providerName ?? 'unknown'} is not ${frozen.providerName}`);
    if (generation.model && generation.model !== frozen.model) provenanceIssues.push(`generation model ${generation.model} is not ${frozen.model}`);
    if (responses.length > 1) provenanceIssues.push(`generation shows ${responses.length} provider responses (fallback attempts)`);
    if (provenanceIssues.length === before) {
      sources.push('generation');
      if (responses.length === 1) singleAttemptProven = true;
    }
  }

  if (sources.length === 0) provenanceIssues.push('no source established the serving provider');
  if (!singleAttemptProven) provenanceIssues.push('a single upstream attempt is not proven (router attempt/attempts or exactly one generation provider response)');
  reasons.push(...provenanceIssues);
  return {
    eligible: reasons.length === 0,
    provenance: provenanceIssues.length === 0 ? 'verified' : 'unverified',
    sources,
    reasons,
  };
}

/** Set-level rule: every counted slot of one experiment has the same non-Skill fingerprint. */
export function fingerprintsAgree(blocks: Array<{ non_skill_fingerprint?: string | null }>): boolean {
  const values = new Set(blocks.map((b) => b.non_skill_fingerprint ?? null));
  return values.size === 1 && !values.has(null);
}
