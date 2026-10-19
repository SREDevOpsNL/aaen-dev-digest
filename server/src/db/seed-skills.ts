/**
 * API Contract skills seeded for the built-in API Contract Reviewer.
 *
 * Each body is a verbatim copy of `docs/skills/api-contract/<name>.md`, and each
 * description is that file's `Description:` line; `server/test/seed-content.test.ts`
 * fails when they drift. The fourth skill, `deprecation-policy`, is deliberately
 * not seeded: it is imported from its file (docs/skills/api-contract/README.md).
 */

export interface SeedSkillContent {
  name: string;
  description: string;
  body: string;
}

/** Linked to the API Contract Reviewer in this order. */
export const API_CONTRACT_SEED_SKILLS: readonly SeedSkillContent[] = [
  {
    name: 'breaking-change',
    description:
      'Flag any change to a published API route that can break an existing client — a removed or renamed route, parameter or field, a changed field type or meaning, a newly required input, or a narrowed set of accepted values — unless it ships under a new API version.',
    body: `# breaking-change

Description: Flag any change to a published API route that can break an existing client — a removed or renamed route, parameter or field, a changed field type or meaning, a newly required input, or a narrowed set of accepted values — unless it ships under a new API version.

## What to flag

- A route, path parameter, query parameter, request field or response field that is removed or renamed on an existing route.
- A field whose type, unit, format or meaning changes, such as an integer that becomes a float or a timestamp that changes format.
- An input that becomes required, or validation that rejects values the route accepted before.
- A changed default, status code or error shape that clients branch on.

## Severity

- CRITICAL: a removal, rename or type change on an existing published route.
- WARNING: a newly required input, narrowed validation, or a changed default, status code or error shape.
- SUGGESTION: an additive change that is safe but undocumented.

## Not a finding

- New optional request fields, new response fields and new routes.
- The same change shipped under a new version prefix while the old version keeps its contract.
- Internal handlers and modules that no client can call.

## Good

\`\`\`ts
// The existing route keeps its contract; the new shape ships as v2.
app.get('/v1/orders/:id', async (req) => ({ id: order.id, customer_id: order.customerId }));
app.get('/v2/orders/:id', async (req) => ({ id: order.id, customer: { id: order.customerId } }));
\`\`\`

## Bad

\`\`\`ts
// Renames a field in place on v1: every client that reads customer_id breaks.
app.get('/v1/orders/:id', async (req) => ({ id: order.id, customerId: order.customerId }));
\`\`\``,
  },
  {
    name: 'response-schema',
    description:
      'Flag a response whose runtime shape is not described by its declared response schema — a field returned but not declared, a declared field no longer returned, a nullability or type mismatch, or a new route without a response schema — because clients and generated SDKs trust the declared contract.',
    body: `# response-schema

Description: Flag a response whose runtime shape is not described by its declared response schema — a field returned but not declared, a declared field no longer returned, a nullability or type mismatch, or a new route without a response schema — because clients and generated SDKs trust the declared contract.

## What to flag

- A handler that adds, removes or renames a returned field without updating the route's declared response schema (Zod, JSON Schema or OpenAPI).
- A field that can now be \`null\` or missing while the schema declares it required and non-null.
- A declared type that no longer matches the returned value (for example a schema that says \`number\` for a value that is now a string).
- A new or changed route with no response schema at all.

## Severity

- CRITICAL: the declared schema promises a field or type that the handler no longer returns.
- WARNING: an undeclared field, a nullability mismatch, or a new route without a response schema.
- SUGGESTION: a schema that is correct but missing field descriptions that clients need.

## Not a finding

- Internal helpers that never reach a response.
- Schema-only refactors that keep the same validated shape.

## Good

\`\`\`ts
const Order = z.object({ id: z.string(), customer_id: z.string(), shipped_at: z.string().nullable() });
app.get('/v1/orders/:id', { schema: { response: { 200: Order } } }, handler);
\`\`\`

## Bad

\`\`\`ts
// The schema still says shipped_at is a required string, but the handler now returns null for unshipped orders.
const Order = z.object({ id: z.string(), customer_id: z.string(), shipped_at: z.string() });
return { id: order.id, customer_id: order.customerId, shipped_at: order.shippedAt ?? null };
\`\`\``,
  },
  {
    name: 'semver-discipline',
    description:
      'Flag a contract change whose version signal does not match its impact — a breaking change shipped without a major version or a new API version, or a version bump that claims more or less than the diff does — so that clients can trust the version to tell them when to change.',
    body: `# semver-discipline

Description: Flag a contract change whose version signal does not match its impact — a breaking change shipped without a major version or a new API version, or a version bump that claims more or less than the diff does — so that clients can trust the version to tell them when to change.

## What to flag

- A breaking change (see \`breaking-change\`) in a package, SDK or API whose version, version prefix or changelog does not announce a new major version.
- A minor or patch bump in \`package.json\`, an OpenAPI \`info.version\` or a changelog entry for a change that breaks clients.
- A major bump or new API version for a purely additive change, which forces clients to migrate for nothing.
- A changelog entry that omits a contract change the diff makes.

## Severity

- CRITICAL: a breaking change released under a minor or patch version, or under the same API version.
- WARNING: a missing or inaccurate changelog entry for a contract change.
- SUGGESTION: an unnecessary major bump for an additive change.

## Not a finding

- Version numbers of private packages that no client consumes.
- Internal refactors with no contract change.

## Good

The package version and the changelog both announce the breaking rename.

\`\`\`json
{ "name": "@acme/payments-client", "version": "3.0.0" }
\`\`\`

\`\`\`markdown
## 3.0.0
- BREAKING: \`Order.customer_id\` is renamed to \`Order.customer.id\`.
\`\`\`

## Bad

The same breaking rename shipped as a patch release.

\`\`\`json
{ "name": "@acme/payments-client", "version": "2.4.1" }
\`\`\``,
  },
];
