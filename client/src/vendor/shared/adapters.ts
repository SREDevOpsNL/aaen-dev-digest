import { z } from 'zod';
import type {
  PrMeta,
  PrDetail,
  IssueMeta,
  PrReviewComment,
} from './contracts/platform.js';

/**
 * Adapter interfaces. ALL external calls go behind these interfaces.
 * Real implementations live in `apps/api/src/adapters/*`; mock implementations
 * live alongside for tests/dev (Services depend on the interface, not the impl).
 */

// ---------- LLM ----------
export const ModelInfo = z.object({
  id: z.string(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  label: z.string().nullish(),
  created: z.number().int().nullish(),
  /** Pricing in USD per 1M tokens (when the provider exposes it, e.g. OpenRouter). */
  pricing: z
    .object({ promptPerM: z.number(), completionPerM: z.number() })
    .nullish(),
  /** Max context window in tokens (when the provider exposes it). */
  contextLength: z.number().int().nullish(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Structured-output request. `schema` is a Zod schema; `schemaName` names the
 * tool / json_schema. `maxRetries` controls reprompt-on-error.
 */
export interface StructuredRequest<T> {
  model: string;
  schema: z.ZodType<T>;
  schemaName: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Cancels the call: the in-flight provider request is aborted and no further
   * attempt starts. Omit it to keep the default behaviour.
   */
  signal?: AbortSignal;
  /**
   * HW2 controlled-experiment mode (opt-in; absent for every ordinary call).
   * A request carrying it makes exactly one HTTP request (no SDK transport
   * retry, no structured-output reprompt), is routed to one frozen upstream
   * provider with fallbacks disabled, asks OpenRouter for routing metadata,
   * and reports every attempt through `onAttempt`, also when it throws.
   */
  experiment?: StructuredExperimentOptions;
  /** Receives one record per dispatched (or refused) attempt; experiment mode only. */
  onAttempt?: (attempt: StructuredAttemptTelemetry) => void;
}

/** Routing for one frozen OpenRouter provider; a provider that is unavailable fails the request. */
export interface ExperimentRouting {
  /** One-item list with the frozen routing slug, e.g. `deepinfra` or `deepinfra/fp8`. */
  order: string[];
  /** The same one-item list: an allow-list, so no other provider can serve it. */
  only: string[];
  allowFallbacks: false;
}

export interface StructuredExperimentOptions {
  /** The authorized experiment slot this request belongs to (one generation per slot). */
  slotId: string;
  /** Must be 0: the OpenAI SDK may not retry a request on its own. */
  transportMaxRetries: 0;
  /** Must be 0: a schema-invalid answer is the slot's outcome, never reprompted. */
  maxRetries: 0;
  routing: ExperimentRouting;
  /** Bounded output; sent as `max_tokens`. */
  maxTokens: number;
  /** Ask OpenRouter for `openrouter_metadata` (`X-OpenRouter-Metadata: enabled`). */
  routerMetadata: true;
  /**
   * Poll `GET /generation?id=…` after a response to corroborate provider,
   * model, tokens and cost. Null = do not look up.
   */
  generationLookup: { attempts: number; delayMs: number } | null;
}

/** What one attempt actually did, from OpenRouter's own metadata, never inferred from the request. */
export interface StructuredAttemptTelemetry {
  sequence: number;
  /** `refused` = blocked before any HTTP request (zero cost). */
  dispatch: 'refused' | 'dispatched';
  outcome:
    | 'valid'
    | 'schema_invalid'
    | 'truncated'
    | 'http_error'
    | 'network_error'
    | 'cancelled'
    | 'refused';
  failureReason: string | null;
  httpStatus: number | null;
  startedAt: string;
  durationMs: number;
  requested: { model: string; routing: ExperimentRouting | null; maxTokens: number | null };
  /** Response `id`; the generation id when it has the `gen-` form. */
  responseId: string | null;
  /** `X-Generation-Id` response header, when present (undocumented; recorded only). */
  generationIdHeader: string | null;
  /** Response top-level `model` ("model used for completion"). */
  servedModel: string | null;
  finishReason: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Provider-reported USD cost (`usage.cost`); null when not reported. */
  costUsd: number | null;
  router: RouterMetadataSummary | null;
  generation: GenerationMetadataSummary | null;
  /** Raw `openrouter_metadata` object as received (secret-free). */
  routerMetadataRaw: unknown;
}

export interface RouterMetadataSummary {
  /** Entries of `endpoints.available` with `selected: true`. */
  selected: Array<{ provider: string; model: string }>;
  /** `attempt` (router-internal attempt number) and `attempts.length`, when present. */
  attempt: number | null;
  attemptsCount: number | null;
  requested: string | null;
  strategy: string | null;
}

export interface GenerationMetadataSummary {
  /** `found` = the lookup returned the generation; `not_found` after bounded polling; `unavailable` = no usable id or error. */
  status: 'found' | 'not_found' | 'unavailable';
  providerName: string | null;
  model: string | null;
  finishReason: string | null;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  totalCost: number | null;
  /** `provider_responses[]`, including fallback attempts. */
  providerResponses: Array<{ providerName: string | null; endpointId: string | null; modelPermaslug: string | null; status: number | null }>;
}

/** One OpenRouter endpoint of a model (`GET /models/{author}/{slug}/endpoints`). */
export interface OpenRouterEndpointInfo {
  providerName: string;
  tag: string | null;
  quantization: string | null;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  /** USD per token (input), per token (output), per request. */
  pricing: { prompt: number; completion: number; request: number };
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Provider-supplied USD cost only; null when the provider did not report it. */
  providerCostUsd: number | null;
  /** Best available cost, which may be provider-reported or token-price estimated. */
  costUsd: number | null;
  raw: string;
  attempts: number;
}

export interface LLMProvider {
  readonly id: 'openai' | 'anthropic';
  listModels(): Promise<ModelInfo[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(texts: string[]): Promise<number[][]>;
}

// ---------- Embedder ----------
export interface Embedder {
  /** OpenAI text-embedding-3-small → 1536 dims. */
  embed(texts: string[]): Promise<number[][]>;
  readonly dims: number;
}

// ---------- GitHub (Octokit REST, thin) ----------
export interface RepoRef {
  owner: string;
  name: string;
}

export interface GitHubReviewPayload {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: { path: string; line: number; body: string }[];
}

/** Create one standalone inline review comment (or a reply to a thread). */
export interface CreateReviewCommentInput {
  /** Head commit the comment pins to (GitHub requires commit_id). */
  commitId: string;
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  body: string;
  /** When set, post as a reply to that comment's thread instead of a new one. */
  inReplyTo?: number;
}

export interface OpenPrPayload {
  title: string;
  head: string;
  base: string;
  body: string;
}

export interface GitHubClient {
  listPullRequests(repo: RepoRef): Promise<PrMeta[]>;
  getPullRequest(repo: RepoRef, n: number): Promise<PrDetail>;
  postReview(repo: RepoRef, n: number, review: GitHubReviewPayload): Promise<{ id: string }>;
  /** List inline review comments on a PR (for the "Files changed" tab). */
  listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]>;
  /** Create one inline review comment (or reply) on a PR; returns the new comment. */
  createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment>;
  openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }>;
  getIssue(repo: RepoRef, n: number): Promise<IssueMeta>;
  /** GET /user — for "posting as @user". */
  currentLogin(): Promise<string>;
}

// ---------- Git (simple-git, heavy) ----------
export interface CloneOptions {
  depth?: number;
  branch?: string;
}

export interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Lines present in the *new* file covered by this hunk (for grounding). */
  newLineNumbers: number[];
}

export interface UnifiedDiff {
  raw: string;
  files: { path: string; additions: number; deletions: number; hunks: DiffHunk[] }[];
}

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  date: string;
  summary: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitClient {
  clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }>;
  fetchPullHead(repo: RepoRef, n: number): Promise<void>;
  currentHead(repo: RepoRef): Promise<string>;
  diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff>;
  blame(repo: RepoRef, path: string): Promise<BlameLine[]>;
  log(repo: RepoRef, path?: string): Promise<GitCommit[]>;
  readFile(repo: RepoRef, path: string): Promise<string>;
  clonePathFor(repo: RepoRef): string;
}

// ---------- CodeIndex (ripgrep + tree-sitter) ----------
export interface CodeMatch {
  path: string;
  line: number;
  text: string;
}

export interface CodeSymbol {
  path: string;
  name: string;
  kind: string;
  line: number;
}

export interface CodeReference {
  fromPath: string;
  toSymbol: string;
  line: number;
}

export interface CodeIndex {
  grep(repo: RepoRef, pattern: string): Promise<CodeMatch[]>;
  symbols(repo: RepoRef): Promise<CodeSymbol[]>;
  references(repo: RepoRef, symbol: string): Promise<CodeReference[]>;
}

// ---------- Auth (pluggable; MVP = LocalNoAuthProvider) ----------
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
}

export interface AuthProvider {
  currentUser(req: unknown): Promise<AuthUser>;
  currentWorkspace(req: unknown): Promise<AuthWorkspace>;
}

// ---------- Secrets (pluggable; MVP = LocalSecretsProvider) ----------
export type SecretKey =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GITHUB_TOKEN'
  | 'DATABASE_URL'
  | (string & {});

export interface SecretsProvider {
  get(key: SecretKey): Promise<string | undefined>;
  /**
   * Persist a secret (BYO key entered via the UI). Optional — read-only
   * providers (e.g. the env-only MVP backend) may omit it.
   */
  set?(key: SecretKey, value: string): Promise<void>;
}
