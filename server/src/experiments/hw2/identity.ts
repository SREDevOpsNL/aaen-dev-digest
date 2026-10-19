import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDisposableDatabaseName } from '../../db/disposable.js';

const run = promisify(execFile);

/** What the operator expects the disposable stack to be (printed by `scripts/e2e.sh --serve`). */
export interface ExpectedStack {
  stackId: string;
  database: string;
  container: string;
  apiUrl: string;
}

/** The API's `/experiments/identity` answer (subset the runner checks). */
export interface StackIdentity {
  stack_id: string;
  database: string;
  database_is_disposable: boolean;
  repos: string[];
  fixture_pulls: number[];
  demo_pr_3_present: boolean;
  fixture_clone_present: boolean;
  provider: string;
  provider_name: string | null;
  model: string;
  max_output_tokens: number;
  in_flight_slot: string | null;
  secrets_path: string;
  openrouter_key_configured: boolean;
}

/** The only key file an experiment stack may read (see platform/config.ts). */
export const DEDICATED_SECRETS_SUFFIX = '/.devdigest/hw2-experiments/secrets.json';

/** Every disagreement between the stack and the expectation; empty = isolated as expected. */
export function identityProblems(identity: StackIdentity, labels: Record<string, string>, expected: ExpectedStack): string[] {
  const problems: string[] = [];
  const url = new URL(expected.apiUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) problems.push(`API ${expected.apiUrl} is not on loopback`);
  if (['3000', '3001'].includes(url.port)) problems.push(`API port ${url.port} is a development port`);
  if (identity.stack_id !== expected.stackId) problems.push(`stack id ${identity.stack_id} is not ${expected.stackId}`);
  if (identity.database !== expected.database) problems.push(`database ${identity.database} is not ${expected.database}`);
  if (!identity.database_is_disposable || !isDisposableDatabaseName(identity.database)) problems.push(`database ${identity.database} is not disposable`);
  if (identity.repos.length !== 1 || identity.repos[0] !== 'acme/payments-api') problems.push(`repositories ${identity.repos.join(', ')} are not exactly acme/payments-api`);
  if (identity.fixture_pulls.join(',') !== '501,502') problems.push('fixture PRs #501 and #502 are not both present');
  if (identity.demo_pr_3_present) problems.push('demo PR #3 is present');
  if (identity.fixture_clone_present) problems.push('a clone of acme/payments-api exists in the clone directory');
  if (!identity.secrets_path.endsWith(DEDICATED_SECRETS_SUFFIX)) problems.push(`secrets file ${identity.secrets_path} is not the dedicated experiment key file`);
  if (labels['devdigest.disposable'] !== 'true') problems.push(`container ${expected.container} is not labelled devdigest.disposable=true`);
  if (labels['devdigest.stack-id'] !== expected.stackId) problems.push(`container label devdigest.stack-id is ${labels['devdigest.stack-id'] ?? 'missing'}`);
  if (labels['devdigest.database'] !== expected.database) problems.push(`container label devdigest.database is ${labels['devdigest.database'] ?? 'missing'}`);
  return problems;
}

/** Labels of the stack's Postgres container (`docker inspect`). */
export async function containerLabels(container: string): Promise<Record<string, string>> {
  const { stdout } = await run('docker', ['inspect', container, '--format', '{{json .Config.Labels}}']);
  return (JSON.parse(stdout.trim() || '{}') ?? {}) as Record<string, string>;
}
