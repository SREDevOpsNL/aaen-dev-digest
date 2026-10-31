import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, unlinkSync, writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractionCapabilityProblem, type ConventionsCapability } from '../../modules/_shared/conventions-experiment.js';
import type { ExtractionPreview } from '../../modules/experiments/conventions.js';
import { canonicalJson, sha256 } from '../../modules/_shared/experiment.js';
import { evaluateSlot } from './eligibility.js';
import { ExtractionReceipts, type ExtractionReceiptEvent } from '../../platform/experiment-receipts.js';
import { ExperimentApi } from './api.js';
import { fits, spent } from './budget.js';
import { containerLabels, type StackIdentity } from './identity.js';
import { KeyUsageLog, readKeyUsage } from './key-usage.js';
import { Ledger, type SlotState } from './ledger.js';

export const extractionRoot = (home = homedir()) => join(home, '.devdigest', 'hw2-experiments');
const SOURCE_COMMIT = '5df959f3af698823dd582f1c3661f3e80df0b5da';
const SOURCE_REPO = 'fastify/fastify';
const SLOT = /^[a-z0-9][a-z0-9-]{2,80}$/;

export interface ExtractionStack {
  api: ExperimentApi;
  identity: StackIdentity & { postgres_system_identifier: string; served_model: string | null };
  stackId: string;
  database: string;
  container: string;
  apiUrl: string;
}

export async function verifyExtractionStack(args: {
  api: ExperimentApi; apiUrl: string; stackId: string; database: string; container: string;
}): Promise<ExtractionStack> {
  const url = new URL(args.apiUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || ['3000', '3001', '3250', '3251'].includes(url.port)) {
    throw new Error('Extraction API must be a separate loopback experiment stack');
  }
  if (!/^hw2f-[a-z0-9]{4,32}$/.test(args.stackId) ||
      !/^devdigest_hw2f_[a-z0-9]{4,32}$/.test(args.database)) {
    throw new Error('Extraction needs a distinctive disposable stack and database');
  }
  const identity = await args.api.get<ExtractionStack['identity']>('/experiments/identity');
  const labels = await containerLabels(args.container);
  let containerSystemId = '';
  try {
    containerSystemId = execFileSync('docker', [
      'exec', args.container, 'psql', '-U', 'devdigest', '-d', args.database,
      '-Atc', 'select system_identifier::text from pg_control_system()',
    ], { encoding: 'utf8', timeout: 15_000 }).trim();
  } catch { throw new Error('Could not read the intended container PostgreSQL cluster ID'); }

  const problems = [
    identity.stack_id === args.stackId ? null : 'stack id mismatch',
    identity.database === args.database && identity.database_is_disposable ? null : 'database mismatch',
    identity.repos.length === 1 && identity.repos[0] === SOURCE_REPO ? null : 'repository set is not the frozen public repository',
    identity.demo_pr_3_present ? 'demo PR #3 is present' : null,
    identity.in_flight_slot ? 'a generation is already in flight' : null,
    identity.openrouter_key_configured ? null : 'dedicated provider key is missing',
    identity.embeddings_enabled === false ? null : 'embeddings are not proven disabled',
    identity.secrets_path.endsWith('/.devdigest/hw2-experiments/secrets.json') ? null : 'non-dedicated key path',
    labels['devdigest.disposable'] === 'true' ? null : 'container disposable label missing',
    labels['devdigest.stack-id'] === args.stackId ? null : 'container stack label mismatch',
    labels['devdigest.database'] === args.database ? null : 'container database label mismatch',
    identity.postgres_system_identifier && identity.postgres_system_identifier === containerSystemId
      ? null : 'API connection and intended container have different PostgreSQL cluster IDs',
    identity.clone_dir === join(extractionRoot(), args.stackId, 'clones') ? null : 'clone directory is not isolated to the extraction stack',
  ].filter((v): v is string => v !== null);
  if (problems.length) throw new Error(`Extraction stack isolation failed: ${problems.join('; ')}`);
  return { ...args, identity };
}

/** The preview's frozen fields must match a second preview just before the request. */
export function extractionPreviewProblems(preview: ExtractionPreview, stack: ExtractionStack, slotId: string, reservationUsd: number): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, name: string) => { if (!ok) problems.push(name); };
  check(preview.ok, `preflight: ${preview.reason ?? 'not ok'}`);
  check(preview.slot_id === slotId, 'slot id');
  check(preview.stack_id === stack.stackId, 'stack id');
  check(preview.database_name === stack.database, 'database');
  check(preview.postgres_system_identifier === stack.identity.postgres_system_identifier, 'PostgreSQL cluster');
  check(preview.repository_full_name === SOURCE_REPO, 'repository name');
  check(preview.repository_commit_sha === SOURCE_COMMIT, 'repository revision');
  check(Array.isArray(preview.sampled_paths) && preview.sampled_paths.length > 0, 'sampled paths');
  check(Array.isArray(preview.indexed_paths) && preview.indexed_paths.length > 0, 'indexed paths');
  check(preview.model === stack.identity.model, 'model');
  check(preview.upstream_provider_slug === stack.identity.provider, 'routing provider');
  check(preview.expected_provider_name === stack.identity.provider_name, 'serving provider');
  check(preview.expected_served_model === stack.identity.served_model, 'served model');
  check(preview.output_cap === 4_000, 'output cap');
  check(preview.reservation_usd === reservationUsd, 'reservation');
  check(Number.isFinite(preview.input_upper_bound) && preview.input_upper_bound > 0, 'input upper bound');
  check(preview.worst_case_usd * 1.2 <= reservationUsd + 1e-12, 'reservation margin');
  for (const [name, value] of Object.entries(preview)) {
    if (name.endsWith('sha256') || name.endsWith('fingerprint')) {
      check(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), name);
    }
  }
  return problems;
}

function privateWrite(path: string, text: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  const dirFd = openSync(join(path, '..'), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
}

/** A durable intent exists before either file can make the grant usable. */
function authorizationSlotUsed(root: string, slotId: string): boolean {
  const path = join(root, 'authorizations.jsonl');
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe authorization log');
  return readFileSync(path, 'utf8').split('\n').filter(Boolean)
    .some((line) => (JSON.parse(line) as { slot_id?: string }).slot_id === slotId);
}

function appendAuthorizationEvent(root: string, event: Record<string, unknown>): void {
  const path = join(root, 'authorizations.jsonl');
  const fd = openSync(path,
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  const line = JSON.stringify(event) + '\n';
  try {
    if (writeSync(fd, line) !== Buffer.byteLength(line)) {
      throw new Error('Authorization log write was incomplete');
    }
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const dirFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
}

/**
 * Write one version-2 capability under the existing global authorize.lock.
 * Requires a separately approved Gate-3 invocation; this function is never
 * called during preview or ordinary reviews.
 */
export function authorizeExtraction(args: {
  preview: ExtractionPreview; stack: ExtractionStack; slotId: string;
  reservationUsd: number; cumulativeCeilingUsd: number;
  keyUsage: { limit_remaining: number | null };
  home?: string; now?: Date;
  /** Test fault injection at each durable write boundary; never passed by the CLI. */
  onBoundary?: (boundary: 'intent' | 'capability' | 'token') => void;
}): { capability: ConventionsCapability; token: string } {
  const root = extractionRoot(args.home);
  if (!SLOT.test(args.slotId)) throw new Error('Invalid extraction slot id');
  const problems = extractionPreviewProblems(args.preview, args.stack, args.slotId, args.reservationUsd);
  if (problems.length) throw new Error(`Extraction preview refused: ${problems.join('; ')}`);
  if (args.keyUsage.limit_remaining === null || args.keyUsage.limit_remaining < args.reservationUsd) {
    throw new Error('Dedicated provider key has no verified remaining limit for this reservation');
  }
  if (!(args.cumulativeCeilingUsd > 0 && args.cumulativeCeilingUsd <= 1.5)) throw new Error('Invalid cumulative ceiling');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error('The shared experiment root is not a private real directory');
  }
  const lock = join(root, 'authorize.lock');
  privateWrite(lock, `${process.pid}\n`);
  try {
    const ledger = new Ledger(root);
    // Serialize authorization with paid runners before reading the ledger.
    ledger.acquire({ pid: process.pid, stackId: args.stack.stackId });
    try {
      if (ledger.unresolved().length) throw new Error('Unresolved reservations must be reconciled first');
      if (ledger.slots().has(args.slotId)) throw new Error('Extraction slot id was already used');
      if (!fits([...ledger.slots().values()], 'exploration', args.reservationUsd).ok ||
          spent(ledger.slots().values()) + args.reservationUsd > args.cumulativeCeilingUsd + 1e-12) {
        throw new Error('Global spending ceiling would be exceeded');
      }
      const otherCapabilities = readdirSync(root).filter((name) => {
        if (!name.startsWith('hw2f-')) return false;
        const path = join(root, name, 'capability.json');
        try { lstatSync(path); return true; } catch { return false; }
      });
      if (otherCapabilities.length) throw new Error(`A live capability already exists: ${otherCapabilities.join(', ')}`);
      if (authorizationSlotUsed(root, args.slotId)) throw new Error('Extraction slot id was already authorized');
      const dir = join(root, args.stack.stackId);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw new Error('Unsafe capability directory');
      const token = randomBytes(32).toString('hex');
      const now = args.now ?? new Date();
      const capability: ConventionsCapability = {
        version: 2, operation: 'conventions.extract',
        capability_id: randomBytes(32).toString('hex'),
        slot_id: args.slotId,
        stack_id: args.stack.stackId,
        database_name: args.preview.database_name,
        postgres_system_identifier: args.preview.postgres_system_identifier,
        workspace_id: args.preview.workspace_id,
        repository_id: args.preview.repository_id,
        repository_full_name: args.preview.repository_full_name,
        repository_commit_sha: args.preview.repository_commit_sha,
        implementation_fingerprint: args.preview.implementation_fingerprint,
        indexed_paths_sha256: args.preview.indexed_paths_sha256,
        samples_sha256: args.preview.samples_sha256,
        request_sha256: args.preview.request_sha256,
        adapter: 'openrouter', model: args.preview.model,
        upstream_provider_slug: args.preview.upstream_provider_slug,
        expected_provider_name: args.preview.expected_provider_name,
        expected_served_model: args.preview.expected_served_model,
        reservation_usd: args.reservationUsd,
        phase: 'exploration', budget_usd: args.reservationUsd,
        cumulative_ceiling_usd: args.cumulativeCeilingUsd,
        authorized_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
        token_sha256: sha256(token),
      };
      const capPath = join(dir, 'capability.json');
      const intent = {
        at: now.toISOString(), event: 'authorization_intent', operation: 'conventions.extract',
        capability_id: capability.capability_id, capability_sha256: sha256(canonicalJson(capability)),
        request_sha256: capability.request_sha256, implementation_fingerprint: capability.implementation_fingerprint,
        stack_id: args.stack.stackId, slot_id: args.slotId, budget_usd: args.reservationUsd,
        ceiling_usd: args.cumulativeCeilingUsd, expires_at: capability.expires_at,
      };
      // The intent is fsynced before the token can exist. A crash after this
      // point leaves an audit trail; the slot may never be reused.
      appendAuthorizationEvent(root, intent);
      args.onBoundary?.('intent');
      privateWrite(capPath, JSON.stringify(capability, null, 2) + '\n');
      args.onBoundary?.('capability');
      try {
        privateWrite(join(dir, 'capability.token'), token);
      } catch (error) {
        unlinkSync(capPath);
        throw error;
      }
      args.onBoundary?.('token');
      try {
        appendAuthorizationEvent(root, {
          ...intent, event: 'authorized', at: new Date().toISOString(),
        });
      } catch (error) {
        unlinkSync(join(dir, 'capability.token'));
        unlinkSync(capPath);
        throw error;
      }
      return { capability, token };
    } finally {
      ledger.release();
    }
  } finally {
    unlinkSync(lock);
  }
}

export interface ExtractionOutcome {
  state: SlotState;
  costUsd: number | null;
  candidateIds: string[];
  reason: string;
}

/** Reconcile a synchronous endpoint from the receipt, never from its HTTP status. */
export function receiptOutcome(events: ExtractionReceiptEvent[], capability?: ConventionsCapability): ExtractionOutcome {
  const last = events.at(-1);
  const attempts = events.filter((event) => event.attempt).map((event) => event.attempt!);
  const attempt = attempts.at(-1);
  if (attempts.length > 1) return { state: 'ambiguous', costUsd: null, candidateIds: [], reason: 'multiple provider attempts' };
  if (!last) return { state: 'ambiguous', costUsd: null, candidateIds: [], reason: 'no receipt' };
  if (attempt?.dispatch === 'refused') return { state: 'refused', costUsd: 0, candidateIds: [], reason: 'provider refused before dispatch' };
  if (last.state === 'persisted' && attempt?.dispatch === 'dispatched' && attempt.outcome === 'valid' &&
      last.cost_usd !== null && last.cost_usd !== undefined && capability) {
    const provenance = evaluateSlot({
      experiment: { dispatch_state: 'completed', diff_sha256: capability.samples_sha256, attempts: [attempt] },
    }, {
      providerName: capability.expected_provider_name,
      model: capability.model,
      servedModel: capability.expected_served_model,
      expectedDiffSha256: capability.samples_sha256,
    });
    if (!provenance.eligible) {
      return { state: 'ambiguous', costUsd: null, candidateIds: [], reason: 'provider provenance is not verified' };
    }
    return { state: 'completed', costUsd: last.cost_usd, candidateIds: last.candidate_ids ?? [], reason: 'persisted with verified provider and cost' };
  }
  if (last.state === 'failed' && last.cost_usd !== null && last.cost_usd !== undefined) {
    return { state: 'failed', costUsd: last.cost_usd, candidateIds: [], reason: 'failed after billable attempt' };
  }
  return { state: 'ambiguous', costUsd: null, candidateIds: [], reason: `${last.state}: cost or completion unknown` };
}

/** Re-read the persisted rows; a receipt alone does not prove a DB commit survived. */
async function verifyPersistedCandidates(api: ExperimentApi, repositoryId: string, events: ExtractionReceiptEvent[]): Promise<boolean> {
  const last = events.at(-1);
  if (last?.state !== 'persisted' || !last.candidate_ids || !last.candidate_digest) return false;
  try {
    const rows = await api.get<Array<{
      id: string; status: string; rule: string; evidence_path: string; evidence_line: number | null;
    }>>(`/repos/${repositoryId}/conventions`);
    const pending = rows.filter((row) => row.status === 'pending');
    const ids = pending.map((row) => row.id);
    const digest = sha256(canonicalJson(pending.map((row) => ({
      id: row.id, rule: row.rule, evidencePath: row.evidence_path, evidenceLine: row.evidence_line,
    }))));
    return canonicalJson(ids) === canonicalJson(last.candidate_ids) && digest === last.candidate_digest;
  } catch {
    return false;
  }
}

/** One HTTP request after durable reservation. No automatic resend, even after a 4xx or process death. */
export async function runExtraction(args: {
  stack: ExtractionStack; preview: ExtractionPreview; capability: ConventionsCapability; token: string;
  ledger: Ledger; log: (message: string) => void;
}): Promise<ExtractionOutcome> {
  const { stack, preview, capability, token, ledger, log } = args;
  if (ledger.slots().has(capability.slot_id)) throw new Error('Extraction slot already appears in the ledger');
  const fresh = await stack.api.post<ExtractionPreview>('/experiments/conventions/preview', {
    repo_id: capability.repository_id,
    slot_id: capability.slot_id,
    reservation_usd: capability.reservation_usd,
  });
  if (canonicalJson(fresh) !== canonicalJson(preview)) throw new Error('Extraction input changed since authorization; no dispatch');
  const authorization = extractionCapabilityProblem(capability, token, fresh);
  if (authorization) throw new Error(`Extraction capability refused: ${authorization}`);
  const budget = fits([...ledger.slots().values()], 'exploration', capability.reservation_usd);
  if (!budget.ok) throw new Error(budget.reason ?? 'Budget refused');
  ledger.append({
    slot_id: capability.slot_id, phase: 'exploration', state: 'reserved',
    reservation_usd: capability.reservation_usd, stack_id: stack.stackId,
    detail: { operation: 'conventions.extract', request_sha256: capability.request_sha256, repository_id: capability.repository_id },
  });
  try {
    await stack.api.request('POST', `/repos/${capability.repository_id}/conventions/extract`, undefined,
      { 'x-hw2-capability': token }, 480_000);
  } catch (error) {
    // A synchronous 4xx can be post-dispatch and billed. The receipt decides.
    log(`Extraction HTTP result requires receipt reconciliation: ${(error as Error).message}`);
  }
  const events = new ExtractionReceipts(ledger.dir).read(capability.slot_id);
  let outcome = receiptOutcome(events, capability);
  if (outcome.state === 'completed' &&
      !(await verifyPersistedCandidates(stack.api, capability.repository_id, events))) {
    outcome = { state: 'ambiguous', costUsd: null, candidateIds: [], reason: 'persisted candidate rows could not be verified' };
  }
  ledger.append({
    slot_id: capability.slot_id, phase: 'exploration', state: outcome.state,
    reservation_usd: capability.reservation_usd, stack_id: stack.stackId,
    cost_usd: outcome.costUsd, detail: { operation: 'conventions.extract', reason: outcome.reason },
  });
  return outcome;
}

/** After a runner crash, settle the reserved extraction slot without dispatching it again. */
export async function reconcileExtraction(
  ledger: Ledger, slotId: string, api?: ExperimentApi, repositoryId?: string,
  root = ledger.dir,
): Promise<ExtractionOutcome> {
  const slot = ledger.slots().get(slotId);
  if (!slot || slot.state !== 'reserved' || slot.events[0]?.detail?.operation !== 'conventions.extract') {
    throw new Error('No reserved conventions extraction to reconcile');
  }
  const events = new ExtractionReceipts(root).read(slotId);
  const stackId = slot.events[0]?.stack_id;
  let capability: ConventionsCapability | undefined;
  if (stackId) {
    const capPath = join(root, stackId, 'capability.json');
    try {
      if (lstatSync(capPath).isFile() && !lstatSync(capPath).isSymbolicLink()) {
        capability = JSON.parse(readFileSync(capPath, 'utf8')) as ConventionsCapability;
      }
    } catch { /* Missing capability keeps the reservation ambiguous. */ }
  }
  if (capability?.slot_id !== slotId) capability = undefined;
  let outcome = receiptOutcome(events, capability);
  if (outcome.state === 'completed' &&
      (!api || !repositoryId || !(await verifyPersistedCandidates(api, repositoryId, events)))) {
    outcome = { state: 'ambiguous', costUsd: null, candidateIds: [], reason: 'persisted rows could not be verified after restart' };
  }
  ledger.append({
    slot_id: slotId, phase: 'exploration', state: outcome.state,
    reservation_usd: slot.reservation_usd, stack_id: slot.events[0]?.stack_id,
    cost_usd: outcome.costUsd, detail: { operation: 'conventions.extract', reconciled: true, reason: outcome.reason },
  });
  return outcome;
}
