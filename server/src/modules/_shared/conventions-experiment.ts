import { timingSafeEqual } from 'node:crypto';
import type { StructuredRequest, StructuredExperimentOptions } from '@devdigest/shared';
import { experimentRequestBody } from '@devdigest/reviewer-core';
import { canonicalJson, sha256 } from './experiment.js';

/** A single, short-lived authorization for one conventions extraction. Version 1 review grants reject it. */
export interface ConventionsCapability {
  version: 2;
  operation: 'conventions.extract';
  capability_id: string;
  slot_id: string;
  stack_id: string;
  database_name: string;
  postgres_system_identifier: string;
  workspace_id: string;
  repository_id: string;
  repository_full_name: string;
  repository_commit_sha: string;
  implementation_fingerprint: string;
  indexed_paths_sha256: string;
  samples_sha256: string;
  request_sha256: string;
  adapter: 'openrouter';
  model: string;
  upstream_provider_slug: string;
  expected_provider_name: string;
  expected_served_model: string;
  reservation_usd: number;
  phase: 'exploration';
  budget_usd: number;
  cumulative_ceiling_usd: number;
  authorized_at: string;
  expires_at: string;
  token_sha256: string;
}

export type ExtractionBinding = Pick<ConventionsCapability,
  'slot_id' | 'stack_id' | 'database_name' | 'postgres_system_identifier' |
  'workspace_id' | 'repository_id' | 'repository_full_name' |
  'repository_commit_sha' | 'implementation_fingerprint' | 'indexed_paths_sha256' | 'samples_sha256' |
  'request_sha256' | 'adapter' | 'model' | 'upstream_provider_slug'>;

const sha = /^[0-9a-f]{64}$/;
const commitSha = /^[0-9a-f]{40}$/;
const slot = /^[a-z0-9][a-z0-9-]{2,80}$/;

/** The exact OpenRouter body plus the execution policy that is not in that body. Credentials are excluded. */
export function extractionRequestSha256(
  request: StructuredRequest<unknown>,
  options: StructuredExperimentOptions,
): string {
  return sha256(canonicalJson({
    body: experimentRequestBody(request, options),
    execution: {
      slot_id: options.slotId,
      transport_max_retries: options.transportMaxRetries,
      structured_max_retries: options.maxRetries,
      timeout_ms: request.timeoutMs ?? null,
      router_metadata: options.routerMetadata,
      generation_lookup: options.generationLookup,
    },
  }));
}

export function extractionCapabilityProblem(
  raw: unknown,
  token: string | undefined,
  expected: ExtractionBinding,
  now = new Date(),
): string | null {
  if (!raw || typeof raw !== 'object') return 'missing capability';
  const cap = raw as Partial<ConventionsCapability>;
  if (cap.version !== 2 || cap.operation !== 'conventions.extract') return 'wrong operation or version';
  if (!slot.test(cap.slot_id ?? '') || !sha.test(cap.capability_id ?? '')) return 'invalid capability identity';
  if (!sha.test(cap.request_sha256 ?? '') || !sha.test(cap.samples_sha256 ?? '') ||
      !sha.test(cap.indexed_paths_sha256 ?? '') ||
      !sha.test(cap.implementation_fingerprint ?? '') || !commitSha.test(cap.repository_commit_sha ?? '')) {
    return 'invalid fingerprint';
  }
  const keys: Array<keyof ExtractionBinding> = [
    'slot_id', 'stack_id', 'database_name', 'postgres_system_identifier',
    'workspace_id', 'repository_id', 'repository_full_name',
    'repository_commit_sha', 'implementation_fingerprint',
    'indexed_paths_sha256', 'samples_sha256', 'request_sha256',
    'adapter', 'model', 'upstream_provider_slug',
  ];
  for (const key of keys) {
    if (cap[key] !== expected[key]) return `capability ${key} mismatch`;
  }
  if (cap.phase !== 'exploration' || cap.adapter !== 'openrouter') return 'invalid extraction phase or adapter';
  if (!cap.expected_provider_name || !cap.expected_served_model) return 'serving provider is not frozen';
  if (!(typeof cap.reservation_usd === 'number' && cap.reservation_usd > 0) ||
      !(typeof cap.budget_usd === 'number' && cap.budget_usd >= cap.reservation_usd && cap.budget_usd <= 0.5) ||
      !(typeof cap.cumulative_ceiling_usd === 'number' && cap.cumulative_ceiling_usd <= 1.5)) {
    return 'invalid spending bound';
  }
  const start = Date.parse(cap.authorized_at ?? '');
  const end = Date.parse(cap.expires_at ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 15 * 60_000 ||
      now.getTime() < start || now.getTime() >= end) return 'capability expired or invalid';
  if (!token || !sha.test(cap.token_sha256 ?? '')) return 'missing token or token hash';
  if (!timingSafeEqual(Buffer.from(sha256(token), 'hex'), Buffer.from(cap.token_sha256!, 'hex'))) return 'token mismatch';
  return null;
}
