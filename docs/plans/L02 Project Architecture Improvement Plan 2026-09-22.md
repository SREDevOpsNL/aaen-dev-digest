# L02 Project Architecture Improvement Plan - 2026-09-22

Status: **active, incremental**. The Skills for Review Agents vertical slice is the first implementation wave; the remaining items are sequenced work, not authorization for a repository-wide rewrite.

## Goal

Improve the whole DevDigest architecture without changing current behavior: clearer frontend ownership, inward backend dependency direction, a demonstrably pure review core, safer persistence boundaries, and checks that stop new drift while existing drift is reduced deliberately.

This assessment applies the new `frontend-ui-architecture` and `onion-architecture` skills together with the existing React, Next.js, Fastify, Drizzle, PostgreSQL, TypeScript, Zod, testing, and security guidance. Performance tuning is intentionally excluded.

## Evidence-based baseline

| Area | Current evidence | Assessment |
| --- | --- | --- |
| Frontend data boundary | The only direct `fetch(` under `client/src` is `client/src/lib/api.ts`; feature code uses typed hooks. | Preserve. This is the right I/O boundary. |
| Frontend ownership | App Router pages generally compose colocated `_components`; the new Skills design follows a rail/editor feature boundary. | Continue route-level colocation and keep pages thin. |
| Pure review engine | `reviewer-core` receives prepared inputs and an injected `LLMProvider`; package guidance forbids DB/HTTP/Git/filesystem access. | Preserve and make the import boundary mechanically testable. |
| Server modules | Several modules already use route/service/repository separation, including agents, reviews, repositories, repo intelligence, and the in-progress skills module. | Use these as the migration pattern. |
| Persistence drift | `polling/routes.ts`, `pulls/routes.ts`, `workspace/routes.ts`, `settings/routes.ts`, `settings/feature-models.ts`, `reviews/diff-loader.ts`, `reviews/run-executor.ts`, and `repos/helpers.ts` import DB/schema code outside a repository boundary. | Reduce when each module is touched; do not normalize this as the target architecture. |
| Atomicity | The in-progress skills and agent-link repositories use Drizzle transactions for versioning/link replacement. | Preserve this pattern and audit other dependent multi-write operations. |
| Composition | Modules are statically registered in `server/src/modules/index.ts`; adapters are resolved by `platform/container.ts`. | Add a registration check and prevent direct service-to-adapter imports. |
| Shared contracts | `server/src/vendor/shared` is canonical and `client/src/vendor/shared` is a manual mirror. | Highest recurring drift risk; every contract change needs a parity check. |
| Capability truth | The product-boundary document correctly warns that schemas, prompt slots, and placeholder tabs are not operational features. | Update it only after the Skills path is verified end to end. |

Large files are review signals, not automatic defects. `repo-intel/service.ts` and its repository are substantial because the subsystem is substantial; split them only around a stable pipeline or adapter boundary, not an arbitrary line count.

## Target dependency model

```text
Next.js page -> feature component -> typed data hook -> API

Fastify route -> application service -> repository / port -> adapter
                                      -> reviewer-core (pure policy)

composition root -> concrete adapters implementing inner ports
```

Dependencies point toward stable policy. Frameworks and vendors remain replaceable outer details. Each feature owns its private internals; cross-feature behavior moves through a stable contract/facade rather than sibling-folder imports.

## Sequenced plan

### Wave 0 - Skills vertical slice (in progress)

Implement the accepted cross-package spec in [the Skills specification](../../specs/01-skills-for-review-agents.md):

- workspace-scoped text-only skill CRUD and immutable body versions;
- one Test Quality Reviewer linked to four ordered test-review skills;
- agent attachment/reordering and reproducible agent snapshots;
- enabled skill bodies included in prompt assembly and run trace;
- Skills rail/editor UI and agent Skills tab matching the updated design;
- Evals, Stats, and community search clearly scaffolded rather than presented as operational;
- server/client contract parity, unit/integration/component coverage, and a product-boundary update only after verification.

Exit gate: all package typechecks and relevant suites pass, the prompt contains enabled skills in deterministic order, disabling/removing a skill removes it, and the trace shows the same assembled block.

### Wave 1 - Establish architectural ratchets

1. Add dependency rules for new violations:
   - reviewer-core cannot import I/O/framework packages;
   - services cannot import concrete adapters;
   - routes cannot import adapters;
   - adapters cannot import feature-module internals;
   - new cross-feature internal imports fail.
2. Baseline existing DB-outside-repository and cycle findings as visible warnings, with exact paths, owners, and removal issues. Do not add broad ignore globs.
3. Add contract mirror parity to CI for files intended to be identical or replace the manual mirror with a generated, checked artifact in a dedicated future decision.
4. Add a module-registration test: a new exported/declared feature plugin must be registered exactly once.

Exit gate: clean boundaries fail CI on regression; known debt is finite and cannot grow silently.

### Wave 2 - Move SQL out of transport incrementally

Prioritize by change frequency and user risk:

1. `pulls`: move list/detail synchronization queries from the route into the existing service/repository boundary; keep GitHub orchestration in the service.
2. `settings`: move storage and feature-model queries into a settings repository; keep secret-provider calls behind the container.
3. `workspace` and `polling`: introduce minimal repositories/services only where behavior exists; avoid ceremonial layers for one read.
4. `reviews`: move schema reads from `diff-loader` and `run-executor` behind the reviews repository/facade while keeping orchestration explicit.
5. `repos/helpers`: accept application-shaped values instead of importing schema rows directly when practical.

For every move, write a characterization test first, preserve response contracts, and remove the corresponding baseline exception in the same change.

Exit gate: transport has no Drizzle/schema imports; services own workflows; repositories own persistence; no route behavior changes.

### Wave 3 - Make transactions match business operations

Inventory workflows that perform dependent writes: repository registration + job creation, review/run finalization, finding persistence, version snapshotting, and replace-all relationships.

- Use one Drizzle transaction when partial success would create an invalid business state.
- Keep external network calls outside long-held database transactions; persist intent, perform I/O, then finalize with explicit state transitions.
- Add failure-injection integration tests proving rollback and retry behavior.
- Document idempotency keys or unique constraints for retryable operations.

Exit gate: every multi-write workflow has an explicit atomicity decision and a failure-path test when partial commit is unsafe.

### Wave 4 - Frontend feature ownership and test seams

1. Continue the current pattern: thin `page.tsx`, feature-owned `_components/<Name>`, feature-local helpers/constants, and API access only through `src/lib/hooks` and `src/lib/api.ts`.
2. Review large feature shells by responsibility, not size. Extract a child only for independent behavior, accessibility, test, or reuse boundaries.
3. Keep TanStack Query server state out of local `useState`; use plain helpers for deterministic transformations.
4. Keep user-facing text in `next-intl` namespaces and API payload types in `@devdigest/shared`.
5. Add loading, empty, error, keyboard, and mutation-failure tests for new interactive surfaces, especially Skills and agent-skill ordering.
6. Keep `src/vendor/ui` changes deliberate and minimal; ordinary feature code wraps primitives outside the vendor tree.

Exit gate: a new route can be understood from its page and one feature folder; important state transitions are testable without an end-to-end environment.

### Wave 5 - Review-core boundary and prompt safety

- Add an import-policy test that proves reviewer-core cannot reach DB, filesystem, GitHub, git, or Fastify.
- Keep all repository-derived content, including skill bodies, delimited as untrusted prompt input; system instructions state that skill criteria may inform review but cannot change role, tools, output contract, or security boundaries.
- Preserve one grounding path and deterministic score computation after all reduce steps.
- Add snapshot/behavior tests for zero, one, disabled, and ordered multiple skill inputs without asserting incidental prose.

Exit gate: the engine remains source-consumable by server/CI, hermetic in tests, and safe against skill-body instruction injection.

### Wave 6 - Documentation and delivery discipline

- Update the product boundary only after an end-to-end capability meets all five operational criteria.
- Move durable implementation explanation from completed specs into canonical architecture/module docs.
- Adopt the planned PR Self Review workflow only after its routing and critical-blocker policy have golden tests; do not install a blocking hook as a side effect of ordinary work.
- Validate all `AGENTS.md`/`CLAUDE.md` links and symlink modes with `node scripts/verify-agent-instructions.mjs`.

## Verification matrix

| Slice | Minimum checks |
| --- | --- |
| Frontend architecture | `client` typecheck + component tests; route loading/empty/error behavior; no component-level direct fetch |
| Server service/repository move | server typecheck + hermetic unit suite; route contract tests |
| Persistence/transaction | DB-backed `*.it.test.ts`; generated migration when schema changes; rollback test |
| Reviewer core | reviewer-core typecheck + tests; server consumer typecheck |
| Shared contract | canonical + client mirror parity; both package typechecks |
| Skills prompt wiring | server integration test proving order/enabled behavior and trace assembly |
| Agent instructions/skills | symlink verifier; skill quick validator; relative-link check |

## Non-goals

- No big-bang folder rewrite.
- No architecture abstraction without a present dependency seam.
- No performance work under the label of organization.
- No hand-edited generated migrations or lockfiles.
- No claim that Evals, Stats, community marketplace, CI review, or import-from-URL is operational because a design tab, contract, or schema exists.

## Sources

The practices and authoritative links are maintained with the skills so future changes update one bibliography:

- [Frontend UI Architecture sources](../../.claude/skills/frontend-ui-architecture/README.md)
- [Onion Architecture sources](../../.claude/skills/onion-architecture/SOURCES.md)
- [Canonical DevDigest architecture](../architecture/00_ARCHITECTURE_OVERVIEW.md)
- [Product capability boundary](../ai-context/01_PRODUCT_BOUNDARY.md)
