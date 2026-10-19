import 'dotenv/config';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';

/**
 * Central, zod-validated environment config. Loaded once at startup.
 *
 * NOTE: secret keys (OPENAI/ANTHROPIC/OPENROUTER/GITHUB_TOKEN) are deliberately
 * NOT in this schema. Feature code must access secrets through SecretsProvider,
 * never via process.env or AppConfig — the SecretsProvider is the one chokepoint
 * that reads process.env directly (see adapters/secrets/local.ts). Listing them
 * here would be dead config that never reaches AppConfig.
 */
const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgres://devdigest:devdigest@localhost:5432/devdigest'),
  // Memory/RAG embeddings run on OpenAI (text-embedding-3-small, 1536-dim — the
  // pgvector columns are locked to that). Default OFF so the app makes ZERO
  // OpenAI requests; set EMBEDDINGS_ENABLED=true to turn memory retrieval on.
  EMBEDDINGS_ENABLED: z.string().optional(),
  // repo-intel facade (Tier 1). Default ON — reviews get repo skeleton +
  // callers context. Set REPO_INTEL_ENABLED=false to opt out, in which case
  // every consumer degrades to ripgrep-identical behavior (acceptance #10).
  // Note: even when on, sections only populate once the repo is indexed; an
  // unindexed repo degrades gracefully. Per-agent override: agents.repo_intel.
  REPO_INTEL_ENABLED: z.string().optional(),
  API_PORT: z.coerce.number().int().default(3001),
  WEB_PORT: z.coerce.number().int().default(3000),
  DEVDIGEST_CLONE_DIR: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // `.env` (and .env.example) ship `LOG_LEVEL=` empty; an empty string is not a
  // valid enum member, so coerce '' → undefined to fall through to the default.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  webPort: number;
  /** Absolute path where repos are cloned (~/.devdigest/workspace by default). */
  cloneDir: string;
  /** Absolute path to the writable secrets store (BYO keys from the UI). */
  secretsPath: string;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for the Next.js dev server. */
  webOrigin: string;
  /** Whether memory/RAG embeddings (OpenAI) are enabled. Default false. */
  embeddingsEnabled: boolean;
  /**
   * Whether the repo-intel facade (Tier 1: phantom-gate, callers-in-prompt) is
   * active. Default ON — set REPO_INTEL_ENABLED=false to opt out, in which case
   * every facade method returns its degraded result (`[]`) so consumers behave
   * EXACTLY like the ripgrep-only baseline.
   */
  repoIntelEnabled: boolean;
  /**
   * HW2 controlled-experiment mode, or null (the default). Set only on a
   * disposable experiment stack (`scripts/e2e.sh --serve`); see
   * `docs/plans/HW2-experiment-operator-guide.md`.
   */
  experiment: ExperimentConfig | null;
};

/** Frozen experiment settings; every field comes from DEVDIGEST_EXPERIMENT_* variables. */
export interface ExperimentConfig {
  /** Disposable stack identity, e.g. `hw2f-1a2b3c4d`; the runner must see the same id. */
  stackId: string;
  /** The one OpenRouter routing slug (`provider.order` and `provider.only`). */
  provider: string;
  /** Expected serving-provider display name; null until exploration freezes it. */
  providerName: string | null;
  model: string;
  maxOutputTokens: number;
  /** Frozen prices: USD per input token, per output token, per request. */
  prices: { input: number; output: number; request: number };
  /** Generation-metadata polling, or null to skip the lookup. */
  generationLookup: { attempts: number; delayMs: number } | null;
}

const EXPERIMENT_REQUIRED = [
  'DEVDIGEST_EXPERIMENT_STACK_ID',
  'DEVDIGEST_EXPERIMENT_PROVIDER',
  'DEVDIGEST_EXPERIMENT_MODEL',
  'DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS',
  'DEVDIGEST_EXPERIMENT_PRICE_INPUT',
  'DEVDIGEST_EXPERIMENT_PRICE_OUTPUT',
] as const;

const ExperimentEnv = z.object({
  DEVDIGEST_EXPERIMENT_STACK_ID: z.string().regex(/^hw2f-[a-z0-9]{4,32}$/),
  DEVDIGEST_EXPERIMENT_PROVIDER: z.string().regex(/^[a-z0-9][a-z0-9._/-]*$/),
  DEVDIGEST_EXPERIMENT_PROVIDER_NAME: z.string().min(1).optional(),
  DEVDIGEST_EXPERIMENT_MODEL: z.string().min(1),
  DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(200_000),
  DEVDIGEST_EXPERIMENT_PRICE_INPUT: z.coerce.number().positive(),
  DEVDIGEST_EXPERIMENT_PRICE_OUTPUT: z.coerce.number().positive(),
  DEVDIGEST_EXPERIMENT_PRICE_REQUEST: z.coerce.number().nonnegative().default(0),
  DEVDIGEST_EXPERIMENT_GENERATION_LOOKUP: z.enum(['0', '1']).default('1'),
});

/**
 * Experiment mode is all-or-nothing: no variable set → null; some set but a
 * required one missing or invalid → a startup error, never a half-enabled mode.
 */
export function loadExperimentConfig(env: NodeJS.ProcessEnv): ExperimentConfig | null {
  const present = Object.keys(env).filter((key) => key.startsWith('DEVDIGEST_EXPERIMENT_') && env[key] !== '');
  if (present.length === 0) return null;
  const missing = EXPERIMENT_REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Partial experiment configuration: missing ${missing.join(', ')}`);
  }
  const parsed = ExperimentEnv.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid experiment configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  const e = parsed.data;
  return {
    stackId: e.DEVDIGEST_EXPERIMENT_STACK_ID,
    provider: e.DEVDIGEST_EXPERIMENT_PROVIDER,
    providerName: e.DEVDIGEST_EXPERIMENT_PROVIDER_NAME ?? null,
    model: e.DEVDIGEST_EXPERIMENT_MODEL,
    maxOutputTokens: e.DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS,
    prices: {
      input: e.DEVDIGEST_EXPERIMENT_PRICE_INPUT,
      output: e.DEVDIGEST_EXPERIMENT_PRICE_OUTPUT,
      request: e.DEVDIGEST_EXPERIMENT_PRICE_REQUEST,
    },
    generationLookup: e.DEVDIGEST_EXPERIMENT_GENERATION_LOOKUP === '1' ? { attempts: 5, delayMs: 1_000 } : null,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const cloneDirRaw =
    parsed.DEVDIGEST_CLONE_DIR ?? join(homedir(), '.devdigest', 'workspace');
  const cloneDir = isAbsolute(cloneDirRaw) ? cloneDirRaw : resolve(process.cwd(), cloneDirRaw);
  return {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    webPort: parsed.WEB_PORT,
    cloneDir,
    secretsPath: join(homedir(), '.devdigest', 'secrets.json'),
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    webOrigin: `http://localhost:${parsed.WEB_PORT}`,
    embeddingsEnabled: parsed.EMBEDDINGS_ENABLED === 'true',
    repoIntelEnabled: parsed.REPO_INTEL_ENABLED !== 'false',
    experiment: loadExperimentConfig(env),
  };
}
