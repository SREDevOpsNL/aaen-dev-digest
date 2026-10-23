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
  /** The seeded cached intent every counted slot must have used (analysis_sha = sha256 of its canonical JSON). */
  intent: { derivation_id: string | null; head_sha: string; prompt_version: number; analysis_sha: string };
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

export function evaluateSlot(trace: { experiment?: unknown; intent?: unknown } | null, frozen: FrozenExpectations): Eligibility {
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

  const intent = (trace?.intent ?? null) as null | {
    source?: string;
    status?: string;
    derivation_id?: string | null;
    head_sha?: string | null;
    prompt_version?: number | null;
    analysis?: unknown;
  };
  if (intent?.source !== 'cache' || intent.status !== 'used') reasons.push('intent was not the fresh cached intent');
  else if (
    intent.derivation_id !== frozen.intent.derivation_id ||
    intent.head_sha !== frozen.intent.head_sha ||
    intent.prompt_version !== frozen.intent.prompt_version ||
    sha256(canonicalJson(intent.analysis ?? null)) !== frozen.intent.analysis_sha
  ) {
    reasons.push('intent snapshot differs from the frozen one');
  }

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
