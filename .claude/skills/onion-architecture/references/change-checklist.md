# Backend architecture change checklist

Read only the sections that match the current change.

## New or changed feature module

- Keep transport in `routes.ts`, orchestration in `service.ts`, SQL in `repository.ts`, and pure transformations in clearly named helpers.
- Register the module in `server/src/modules/index.ts`.
- Validate request and response shapes with the shared Zod/type-provider conventions.
- Scope domain queries by workspace.
- Use `.js` extensions on relative ESM imports in `server` and `reviewer-core`.

## New external dependency

1. Decide whether it is a domain concept or a technology detail.
2. For a replaceable or side-effecting capability, define the smallest application-facing port.
3. Implement the SDK-specific adapter under `server/src/adapters`.
4. Bind it in the container and inject a test double at the seam.
5. Do not leak SDK types through the port.

Do not create an interface around a pure local helper or a stable value object just to satisfy a diagram.

## Persistence

- Keep SQL/Drizzle inside repositories.
- Model database constraints explicitly; Drizzle application relations do not create foreign-key constraints.
- Put one business operation that performs dependent writes in one transaction.
- Change `server/src/db/schema/*.ts`, then generate and apply a migration with the server's **pnpm** commands. Never hand-edit a generated migration.
- Name real-Postgres tests `*.it.test.ts`; keep pure service tests hermetic.

## Fastify transport

- Register shared plugins before feature plugins that inherit their decorators/hooks.
- Use encapsulation deliberately; avoid global decorators or hooks for feature-local behavior.
- Validate before the handler and keep handlers thin.
- Do not expose persistence rows as accidental HTTP contracts.

## Review severity

- Critical: inward layer imports an outer technology; pure core performs I/O; route bypasses authorization/workspace scope; atomic writes can partially commit; schema change lacks migration.
- Major: route owns business orchestration; SDK type leaks through a port; feature imports sibling internals; persistence logic is duplicated outside a repository.
- Minor: naming or placement inconsistency that does not weaken a boundary.

## Verification

Run the package-specific commands from `AGENTS.md`. For server changes, use `pnpm typecheck` and the hermetic unit subset first; run DB-backed tests for persistence changes. For reviewer-core, use its npm typecheck and tests. If dependency-cruiser configuration exists, run it as an additional boundary check; do not claim a gate exists merely because the package is installed.
