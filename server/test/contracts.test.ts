import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrMeta,
  PrDetail,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
    expect(trace.stats.cost_usd).toBeUndefined();
  });

  // The shape every failure path wrote before lifecycle evidence existed (as
  // in the preserved Item B v3 failure trace; all text here is synthetic).
  const legacyFailedTrace = {
    config: { agent: 'Test Quality Reviewer', version: '16', provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', pr: 501, source: 'local' },
    stats: { duration_ms: 106577, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding: '0/0 passed' },
    prompt_assembly: { system: 'Synthetic reviewer system prompt.', skills: null, memory: null, specs: null, user: '' },
    tool_calls: [],
    raw_output: '',
    memory_pulled: [],
    specs_read: [],
    log: [{ t: '00.00', kind: 'error', msg: 'Run failed: output reached the max_tokens cap (finish_reason=length) for Review; experiment mode does not reprompt' }],
    experiment: {
      stack_id: 'hw2f-synthetic', slot_id: 'c-17-with-2', experiment: '17', condition: 'with', phase: 'confirmatory',
      manifest_fingerprint: 'a'.repeat(64), dispatch_state: 'failed', refusal_reason: 'output reached the max_tokens cap',
      diff_sha256: 'b'.repeat(64), expected_diff_sha256: 'b'.repeat(64), non_skill_fingerprint: 'c'.repeat(64),
      skill_fingerprint: 'd'.repeat(64), expected_non_skill_fingerprint: 'c'.repeat(64),
      routing: { order: ['deepinfra/fp8'], only: ['deepinfra/fp8'], allow_fallbacks: false }, preflight: null, usage_known: true,
      attempts: [{ sequence: 1, dispatch: 'dispatched', outcome: 'truncated', tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278, finishReason: 'length' }],
    },
  };

  it('an old JSONB trace (legacy failure fallback, no lifecycle fields) still validates unchanged', () => {
    const trace = RunTrace.parse(legacyFailedTrace);
    expect(trace).toEqual(legacyFailedTrace);
    expect(trace.dispatch).toBeUndefined();
    expect(trace.prompt_assembly_source).toBeUndefined();
    expect(trace.stats.usage_state).toBeUndefined();
  });

  it('a trace with lifecycle evidence validates; unknown usage is null, never a fallback zero', () => {
    const assembly = { system: 'Synthetic system.', skills: '<untrusted source="skill-0">\n### Synthetic\n</untrusted>', user: 'Synthetic diff' };
    const trace = RunTrace.parse({
      ...legacyFailedTrace,
      stats: { ...legacyFailedTrace.stats, tokens_in: null, tokens_out: null, cost_usd: null, usage_state: 'unknown' },
      prompt_assembly: assembly,
      prompt_assembly_source: 'dispatched_request',
      prompt_assembly_sha256: 'e'.repeat(64),
      dispatch: { state: 'dispatched' },
      stages: [
        {
          stage_id: 'single-0', kind: 'single', index: 0, count: 1, label: 'all files', state: 'failed',
          assembly_sha256: 'e'.repeat(64), assembly_bytes: 60, assembly_complete: true, usage_state: 'unknown',
          usage: { tokens_in: null, tokens_out: null, cost_usd: null },
          attempts: [{ attempt: 1, retry: 'initial', phase: 'submitted', submitted_at: '2026-11-01T00:00:00Z', response_id: null, finish_reason: null, http_status: 429, failure: 'http_error', usage: null, verified_usage: null }],
        },
      ],
      partial_output: null,
      persistence: { state: 'reaped', at: '2026-11-01T00:00:00Z', note: 'n' },
    });
    expect(trace.stats.tokens_in).toBeNull();
    expect(trace.stages?.[0]?.attempts[0]?.phase).toBe('submitted');
    expect(() => RunTrace.parse({ ...trace, dispatch: { state: 'sent' } })).toThrow();
    expect(() => RunTrace.parse({ ...trace, partial_output: { kind: 'truncated', text: 'x', provider_incomplete: false } })).toThrow();
  });

  it('accepts authoritative run cost across PR, review, and run DTOs', () => {
    const pr = PrMeta.parse({
      number: 482,
      title: 't',
      author: 'a',
      branch: 'b',
      base: 'main',
      head_sha: 'sha',
      additions: 1,
      deletions: 0,
      files_count: 1,
      status: 'reviewed',
      cost_usd: 0.012,
    });
    const review = ReviewRecord.parse({
      id: 'review-1',
      pr_id: 'pr-1',
      agent_id: 'agent-1',
      run_id: 'run-1',
      kind: 'review',
      verdict: 'approve',
      summary: 'ok',
      score: 100,
      cost_usd: 0.012,
      model: 'openrouter/test',
      created_at: '2026-09-21T00:00:00Z',
      findings: [],
    });
    const run = RunSummary.parse({
      run_id: 'run-1',
      agent_id: 'agent-1',
      agent_name: 'General Reviewer',
      provider: 'openrouter',
      model: 'openrouter/test',
      status: 'done',
      error: null,
      duration_ms: 100,
      tokens_in: 10,
      tokens_out: 5,
      cost_usd: null,
      findings_count: 0,
      grounding: '0/0 passed',
      ran_at: '2026-09-21T00:00:00Z',
      score: 100,
      blockers: 0,
    });

    expect(pr.cost_usd).toBe(0.012);
    expect(review.cost_usd).toBe(0.012);
    expect(run.cost_usd).toBeNull();
    expect(() => PrMeta.parse({ ...pr, cost_usd: -0.01 })).toThrow();
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});
