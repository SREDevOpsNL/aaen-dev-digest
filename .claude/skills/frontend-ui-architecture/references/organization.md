# Component and module organization

Read this reference when deciding where a frontend file belongs or how to split a feature.

## Start with ownership

Use the narrowest owner that can explain the file's purpose:

| Concern | Default location |
| --- | --- |
| UI used by one route or feature | Colocated `_components/<Name>/` folder |
| Stateful React orchestration used by one feature | Colocated hook next to that feature |
| Server/API access | Existing typed data hook layer |
| Pure calculation or business rule | Feature-local named module or helper |
| UI primitive used across unrelated features | Shared components layer |
| Stable cross-feature constant/type | Lowest common shared module |

Promotion is a dependency decision, not housekeeping. Move a file to shared only when multiple independent consumers need the same contract. If two similar components change for different reasons, prefer duplication over a misleading abstraction.

## Split by responsibility

Split when one of these seams is present:

- a section has its own behavior, loading/error state, or accessible interaction;
- stateful orchestration can be described independently from rendering;
- a pure rule can be tested without React;
- I/O can be hidden behind an existing data boundary;
- a child needs an explicit reusable API.

Do not split solely because a file passed an arbitrary line limit. A cohesive 250-line editor can be clearer than ten two-line wrappers.

## Business logic

- Component: render and translate user events into named operations.
- Hook: React state, effects, subscriptions, and composition of data hooks.
- Plain module: validation, transformations, decisions, and calculations independent of React.
- Data hook/client: remote state and API calls.

In this repository, `client/src/lib/hooks/*` owns API access and TanStack Query. Components must not call `fetch` directly or mirror server state into `useState`. User-facing strings belong in `client/messages/<locale>/*.json`; shared API payload types come from `@devdigest/shared`.

## Constants and helpers

- Keep a literal inline when its meaning is obvious and it has one use.
- Give a domain-significant value a name close to its consumer.
- Use a feature-local `constants.ts` only when several files in that feature share the values.
- Extract a helper when it makes a rule independently understandable or testable.
- Prefer names such as `buildSkillDraft` or `formatFindingCount` over `processData` or a generic `helpers` grab bag.

## Review questions

1. Can a reader find the behavior from the route without searching the whole repository?
2. Does each dependency point toward a more stable abstraction?
3. Are remote state, React state, and pure decisions distinguishable?
4. Is shared code actually shared, with a coherent public surface?
5. Can the important rule be tested at the cheapest layer?
