---
name: frontend-ui-architecture
description: Decide React and Next.js UI architecture and code placement. Use when locating or splitting components, hooks, constants, utilities, feature logic, and App Router files, or when reviewing frontend boundaries. Focuses on architecture and organization, not rendering performance.
metadata:
  version: "1.1.0"
---

# Frontend UI Architecture

Keep pages and visual components easy to read by placing each responsibility at the narrowest scope that owns it.

## Workflow

1. Read the closest `AGENTS.md` and inspect nearby code before proposing a new structure.
2. Identify the change boundary: one route, one feature, cross-feature UI, or application infrastructure.
3. Colocate code with its only consumer. Promote it only when a real second consumer appears.
4. Separate rendering, React orchestration, pure domain decisions, and I/O at natural seams; do not manufacture layers around trivial code.
5. Preserve framework boundaries and the repository's existing conventions.
6. Validate the smallest affected behavior and explain any new shared abstraction.

## Placement rules

- Keep route entrypoints thin. They compose feature components and route state; they do not become feature modules.
- Extract a child component when it has an independent UI responsibility, lifecycle, test surface, or reuse case. Line count alone is not a boundary.
- Extract a custom hook for reusable stateful React orchestration or synchronization with an external system. A hook shares logic, not state.
- Put deterministic, framework-independent transformations and business rules in plain functions. Do not hide them in a component or a hook merely because the caller is React.
- Keep constants near their single consumer. Promote stable cross-feature constants to the lowest common owner; do not create a global constants drawer.
- Name helpers by domain intent. Use `utils` only for genuinely generic, side-effect-free operations.
- Prefer explicit props and composition. Use context for stable cross-cutting data consumed across a subtree, after considering props and children.
- Avoid barrels that obscure ownership, create cycles, or turn private feature internals into public APIs.

## Where things live in `client/src`

| What | Location |
| --- | --- |
| App Router page | `app/<segment>/page.tsx` (dynamic segments `[id]`, `[repoId]`); thin, composes feature components |
| Page-owned components | `app/<segment>/_components/<Name>/<Name>.tsx`, with nested `_components/` for their private children |
| Page-owned helpers and constants | `app/<segment>/helpers.ts`, `constants.ts`, `styles.ts` beside the page |
| Shared components (used by more than one route) | `components/<area>/`, e.g. `components/app-shell/`, `components/diff-viewer/<Name>/` |
| Data hooks and API access | `lib/hooks/<domain>.ts` over `lib/api.ts`; components never call `fetch` directly |
| Vendored UI primitives | `vendor/ui` (`@devdigest/ui`): consume, do not modify |
| Tests | beside the code they cover: `<Name>.test.tsx` next to the component, `<file>.test.ts` next to a helper |

## Naming conventions

- React components and their folders: PascalCase (`AgentCard/AgentCard.tsx`), one component per folder with an `index.ts` when the folder has a public entry.
- Hooks: camelCase starting with `use` (`useSkills`); functions and variables: camelCase; module-level constants: UPPER_SNAKE_CASE (`MAX_AGENT_SKILLS`).
- Route segments and shared area folders: kebab-case (`app/repos/[repoId]/pulls`, `components/app-shell`); private route folders start with `_` (`_components`).
- Tests: `*.test.ts(x)` beside the subject; user-facing strings come from `next-intl` messages, not literals in JSX.

## Project routing

- For detailed placement and extraction decisions, read [references/organization.md](references/organization.md).
- For App Router colocation, route groups, private folders, and server/client boundaries, read [references/nextjs.md](references/nextjs.md).
- Use `react-best-practices` for React correctness, `next-best-practices` for framework mechanics, and `react-testing-library` for test design. This skill owns placement and boundaries.

The human-facing scope, version, and complete source list are in [README.md](README.md).
