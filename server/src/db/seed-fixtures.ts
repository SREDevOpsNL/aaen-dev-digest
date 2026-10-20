/**
 * Disposable experiment fixtures for Homework 2 (criteria 17 and 18).
 *
 * Two seeded PRs in the demo repository `acme/payments-api`, reviewed only from
 * their stored `pr_files` patches (the repository is never cloned, so
 * `loadDiff` falls back to `diffFromPrFiles`). Each carries a neutral cached
 * intent that the seed stores as fresh, so a review batch reuses it and never
 * derives one. Bodies contain no closing keyword (no linked-issue fetch) and do
 * not hint at the defect.
 *
 * The content is a draft until the experiment pre-registration freezes it
 * (docs/plans/HW2-experiment-preregistration.md). Demo PR #3 and PR #482 are
 * not touched.
 */
import type { IntentAnalysis } from '@devdigest/shared';

export interface FixtureFile {
  path: string;
  /** Unified-diff hunks for this file, as GitHub returns them in `patch`. */
  patch: string;
}

/** A changed-line range the expected finding may cite; must survive grounding. */
export interface ExpectedAnchor {
  file: string;
  start_line: number;
  end_line: number;
}

export interface ExperimentFixture {
  number: number;
  title: string;
  author: string;
  branch: string;
  headSha: string;
  body: string;
  commitMessage: string;
  files: FixtureFile[];
  /** Reviewer and the one skill whose effect the experiment measures. */
  reviewer: string;
  targetSkill: string;
  /** What the reviewer should find, and the changed lines it may cite. */
  expectedDefect: string;
  expectedAnchors: ExpectedAnchor[];
  intent: { summary: string; analysis: IntentAnalysis };
}

export const EXPERIMENT_FIXTURES: readonly ExperimentFixture[] = [
  {
    number: 501,
    title: 'Add coupon discounts to checkout totals',
    author: 'jonas.weber',
    branch: 'feat/checkout-coupons',
    headSha: 'b501c0d15c01',
    body: 'Adds coupon codes that reduce the checkout total by a percentage, with a unit test.',
    commitMessage: 'Add percentage coupons to checkout totals',
    files: [
      {
        path: 'src/billing/discount.ts',
        patch: `@@ -0,0 +1,15 @@
+export type Coupon = { code: string; percentOff: number; expiresAt: Date };
+
+const COUPONS: Record<string, Coupon> = {
+  SAVE10: { code: 'SAVE10', percentOff: 10, expiresAt: new Date('2027-01-01T00:00:00Z') },
+  HALF: { code: 'HALF', percentOff: 50, expiresAt: new Date('2026-12-31T00:00:00Z') },
+};
+
+/** Total after the coupon, in cents. Throws for an unknown or expired code. */
+export function applyDiscount(totalCents: number, code: string, now: Date): number {
+  const coupon = COUPONS[code.toUpperCase()];
+  if (!coupon) throw new Error(\`Unknown coupon: \${code}\`);
+  if (now >= coupon.expiresAt) throw new Error(\`Coupon expired: \${code}\`);
+  const percent = Math.min(coupon.percentOff, 100);
+  return Math.max(Math.round(totalCents * (1 - percent / 100)), 0);
+}`,
      },
      {
        path: 'src/billing/discount.test.ts',
        patch: `@@ -0,0 +1,8 @@
+import { describe, expect, it } from 'vitest';
+import { applyDiscount } from './discount';
+
+describe('applyDiscount', () => {
+  it('applies a percentage coupon', () => {
+    expect(applyDiscount(10_000, 'SAVE10', new Date('2026-06-01T00:00:00Z'))).toBe(9_000);
+  });
+});`,
      },
    ],
    reviewer: 'Test Quality Reviewer',
    targetSkill: 'Edge Cases and Error Paths',
    expectedDefect:
      'The only test covers the happy path; the unknown-coupon and expired-coupon errors and the expiry boundary are untested.',
    expectedAnchors: [
      { file: 'src/billing/discount.test.ts', start_line: 4, end_line: 8 },
      { file: 'src/billing/discount.ts', start_line: 11, end_line: 12 },
    ],
    intent: {
      summary: 'Adds percentage coupon codes to checkout totals',
      analysis: {
        claimed_purpose: 'Add coupon codes that reduce the checkout total by a percentage.',
        supported_points: [
          {
            statement: 'Adds applyDiscount, which applies a percentage coupon to a total in cents',
            evidence: [{ file: 'src/billing/discount.ts', side: 'new', start_line: 9, end_line: 15 }],
          },
        ],
        discrepancies: [],
        in_scope: ['coupon discounts on checkout totals'],
        out_of_scope: ['payment capture', 'coupon administration'],
        confidence: 'medium',
        unverified_statements: [],
      },
    },
  },
  {
    number: 502,
    title: 'Return payment amounts as decimal strings',
    author: 'priya.nair',
    branch: 'feat/decimal-amounts',
    headSha: 'b502dec1a502',
    body: 'Returns payment amounts as decimal strings so the dashboard can display them without converting from cents.',
    commitMessage: 'Return payment amounts as decimal strings',
    files: [
      {
        path: 'src/api/payments.ts',
        patch: `@@ -12,11 +12,11 @@ export async function registerPaymentRoutes(app: FastifyInstance) {
   app.get('/v1/payments/:id', async (request, reply) => {
     const payment = await findPayment(request.params.id);
     if (!payment) return reply.code(404).send({ error: 'not_found' });
     return {
       id: payment.id,
       status: payment.status,
-      amount_cents: payment.amountCents,
+      amount: (payment.amountCents / 100).toFixed(2),
       currency: payment.currency,
       created_at: payment.createdAt.toISOString(),
     };
   });`,
      },
    ],
    reviewer: 'API Contract Reviewer',
    targetSkill: 'breaking-change',
    expectedDefect:
      'The published v1 response field amount_cents (number) is renamed to amount (string) in place, with no new version or deprecation, which breaks existing clients.',
    expectedAnchors: [{ file: 'src/api/payments.ts', start_line: 18, end_line: 18 }],
    intent: {
      summary: 'Returns payment amounts as decimal strings',
      analysis: {
        claimed_purpose:
          'Return payment amounts as decimal strings so the dashboard can display them without converting from cents.',
        supported_points: [
          {
            statement: 'Changes how the payment amount is returned by GET /v1/payments/:id',
            evidence: [{ file: 'src/api/payments.ts', side: 'new', start_line: 18, end_line: 18 }],
          },
        ],
        discrepancies: [],
        in_scope: ['payment amount formatting in the payments API'],
        out_of_scope: ['payment creation', 'currency conversion'],
        confidence: 'medium',
        unverified_statements: [],
      },
    },
  },
];

/** Added and removed line counts of a unified-diff patch (hunk headers excluded). */
export function patchStats(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

/**
 * Label carried by every synthetic convention candidate. The final Conventions
 * walkthrough may use these instead of a live (paid) extraction; they are not a
 * model extraction and must never be presented as one. The real extraction path
 * is covered by `server/test/conventions.it.test.ts` (mocked model).
 */
export const SYNTHETIC_CONVENTION_LABEL = 'Synthetic fixture — not a model extraction.';

export interface SyntheticConvention {
  category: 'naming' | 'structure' | 'errors' | 'testing' | 'imports' | 'typing' | 'api' | 'general';
  rule: string;
  rationale: string;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
}

/** Pending candidates for `acme/payments-api`, citing lines of the fixture patches. */
export const SYNTHETIC_CONVENTIONS: readonly SyntheticConvention[] = [
  {
    category: 'api',
    rule: "Answer a missing resource with HTTP 404 and the body { error: 'not_found' }",
    rationale: `${SYNTHETIC_CONVENTION_LABEL} Clients branch on the error code.`,
    evidencePath: 'src/api/payments.ts',
    evidenceLine: 14,
    evidenceSnippet: "    if (!payment) return reply.code(404).send({ error: 'not_found' });",
    confidence: 0.82,
  },
  {
    category: 'errors',
    rule: 'Throw an Error whose message names the rejected input',
    rationale: `${SYNTHETIC_CONVENTION_LABEL} Callers log the message as is.`,
    evidencePath: 'src/billing/discount.ts',
    evidenceLine: 11,
    evidenceSnippet: '  if (!coupon) throw new Error(`Unknown coupon: ${code}`);',
    confidence: 0.74,
  },
  {
    category: 'naming',
    rule: 'Suffix integer money amounts with Cents',
    rationale: `${SYNTHETIC_CONVENTION_LABEL} Amounts are kept as integer cents.`,
    evidencePath: 'src/billing/discount.ts',
    evidenceLine: 9,
    evidenceSnippet: 'export function applyDiscount(totalCents: number, code: string, now: Date): number {',
    confidence: 0.66,
  },
  {
    category: 'testing',
    rule: 'Keep unit tests next to the module as <name>.test.ts',
    rationale: `${SYNTHETIC_CONVENTION_LABEL} Tests sit beside the code they cover.`,
    evidencePath: 'src/billing/discount.test.ts',
    evidenceLine: 2,
    evidenceSnippet: "import { applyDiscount } from './discount';",
    confidence: 0.7,
  },
];
