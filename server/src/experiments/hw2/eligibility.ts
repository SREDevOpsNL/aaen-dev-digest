import { canonicalJson, sha256 } from '../../modules/_shared/experiment.js';

/**
 * Whether one completed slot is strict single-generation evidence. Only
 * OpenRouter's reported metadata counts; the requested routing is intent, not
 * evidence. Anything missing, ambiguous or showing more than one upstream
 * attempt makes the slot ineligible (it stays in the ledger and the report).
 */

export interface FrozenExpectations {
  providerName: string;
  /** The requested model slug, which the chat response's `model` echoes. */
  model: string;
  /**
   * The served model version, as OpenRouter's records name it: the router's
   * selected model, the generation's model and each provider response's
   * `model_permaslug` must all equal it.
   */
  servedModel: string;
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
    providerResponses?: Array<{ providerName: string | null; modelPermaslug?: string | null; status?: number | null }>;
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
    else if (selected[0]!.model !== frozen.servedModel) provenanceIssues.push(`router selected model ${selected[0]!.model}, not ${frozen.servedModel}`);
    if (provenanceIssues.length === before) sources.push('router_metadata');
    const attemptNo = router.attempt;
    const attemptsCount = router.attemptsCount;
    if ((typeof attemptNo === 'number' && attemptNo !== 1) || (typeof attemptsCount === 'number' && attemptsCount !== 1)) {
      provenanceIssues.push('router metadata shows more than one upstream attempt');
    } else if (attemptNo === 1 && attemptsCount === 1) {
      singleAttemptProven = true;
    }
  }

  // Generation metadata: corroborates the provider and the served model;
  // exactly one provider response, from the frozen provider and model with
  // HTTP 200, proves a single generation. None (empty or missing) proves nothing.
  const generation = attempt.generation ?? null;
  if (generation?.status === 'found') {
    const before = provenanceIssues.length;
    const responses = generation.providerResponses ?? [];
    if (generation.providerName !== frozen.providerName) provenanceIssues.push(`generation provider ${generation.providerName ?? 'unknown'} is not ${frozen.providerName}`);
    if (generation.model !== frozen.servedModel) provenanceIssues.push(`generation model ${generation.model ?? 'unknown'} is not ${frozen.servedModel}`);
    if (responses.length > 1) provenanceIssues.push(`generation shows ${responses.length} provider responses (fallback attempts)`);
    for (const response of responses) {
      if (response.providerName !== frozen.providerName || response.modelPermaslug !== frozen.servedModel || response.status !== 200) {
        provenanceIssues.push(
          `generation provider response ${response.providerName ?? 'unknown'} / ${response.modelPermaslug ?? 'unknown'} / status ${response.status ?? 'unknown'} is not ${frozen.providerName} / ${frozen.servedModel} / 200`,
        );
      }
    }
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

/** The two reasons a truncated slot is ineligible by construction; any other reason is a real gap. */
const TRUNCATION_REASONS = new Set(['dispatch_state failed', 'attempt outcome truncated']);

/**
 * How much provenance a truncated slot needs to continue and be imputed:
 * - `strict`: everything strict eligibility asks for, apart from the
 *   truncation itself;
 * - `single-router-attempt` (the frozen v4 rule): `strict`, or router
 *   metadata alone proving one upstream attempt on the frozen endpoint while
 *   the generation lookup found nothing (OpenRouter can return `not_found`
 *   for a truncated generation, as it did for v3 `c-17-with-2`). The
 *   imputation counts against the hypothesis, so the weaker level cannot
 *   help a pass.
 */
export type TruncationProvenancePolicy = 'strict' | 'single-router-attempt';

/** The provenance a continued truncation rested on, recorded on the ledger and the report row. */
export type TruncationProvenance = 'verified' | 'router_metadata_only';

/** Why the router metadata alone does not prove one attempt on the frozen endpoint (empty when it does). */
function routerOnlyProblems(experiment: { diff_sha256?: string | null }, attempt: Attempt, frozen: FrozenExpectations): string[] {
  const problems: string[] = [];
  if (experiment.diff_sha256 !== frozen.expectedDiffSha256) problems.push('diff hash differs from the frozen fixture');
  if (attempt.servedModel !== frozen.model) problems.push(`served model ${attempt.servedModel ?? 'unknown'} is not ${frozen.model}`);
  const router = attempt.router ?? null;
  if (!router) return [...problems, 'no router metadata'];
  const selected = router.selected ?? [];
  if (selected.length !== 1) problems.push(`router metadata selected ${selected.length} endpoints`);
  else if (selected[0]!.provider !== frozen.providerName || selected[0]!.model !== frozen.servedModel) {
    problems.push(`router selected ${selected[0]!.provider} / ${selected[0]!.model}, not ${frozen.providerName} / ${frozen.servedModel}`);
  }
  // attempt must say 1; attempts, when present, must say 1 too.
  if (router.attempt !== 1) problems.push(`router attempt is ${router.attempt ?? 'unknown'}, not 1`);
  if (router.attemptsCount !== null && router.attemptsCount !== undefined && router.attemptsCount !== 1) problems.push(`router metadata shows ${router.attemptsCount} upstream attempts`);
  const generation = attempt.generation ?? null;
  if (generation?.status === 'found') {
    const responses = generation.providerResponses ?? [];
    const one = responses.length === 1 ? responses[0]! : null;
    if (!one || generation.providerName !== frozen.providerName || generation.model !== frozen.servedModel ||
        one.providerName !== frozen.providerName || one.modelPermaslug !== frozen.servedModel || one.status !== 200) {
      problems.push('the generation was found but does not show exactly one response from the frozen provider and model');
    }
  } else if (generation?.status !== 'not_found') {
    problems.push(`generation lookup ${generation?.status ?? 'missing'}, neither found nor not_found`);
  }
  return problems;
}

/**
 * Whether a settled slot is a provenance-checked truncation (one dispatched
 * attempt whose outcome is `truncated`, `finish_reason=length`), what else is
 * wrong with it, and the provenance level it meets. `problems` is empty only
 * when `policy` accepts its provenance.
 */
export function truncationCheck(
  trace: { experiment?: unknown } | null,
  frozen: FrozenExpectations,
  policy: TruncationProvenancePolicy = 'strict',
): { truncated: boolean; problems: string[]; provenance: TruncationProvenance | null } {
  const experiment = (trace?.experiment ?? null) as null | { dispatch_state?: string; diff_sha256?: string | null; attempts?: Attempt[] };
  const attempts = experiment?.attempts ?? [];
  const truncated = experiment?.dispatch_state === 'failed' && attempts.length === 1 &&
    attempts[0]!.dispatch === 'dispatched' && attempts[0]!.outcome === 'truncated';
  if (!truncated) return { truncated: false, problems: [], provenance: null };
  const strict = evaluateSlot(trace, frozen).reasons.filter((reason) => !TRUNCATION_REASONS.has(reason));
  if (strict.length === 0) return { truncated: true, problems: [], provenance: 'verified' };
  if (policy !== 'single-router-attempt') return { truncated: true, problems: strict, provenance: null };
  const routerOnly = routerOnlyProblems(experiment!, attempts[0]!, frozen);
  return routerOnly.length === 0
    ? { truncated: true, problems: [], provenance: 'router_metadata_only' }
    : { truncated: true, problems: [...new Set([...strict, ...routerOnly])], provenance: null };
}
