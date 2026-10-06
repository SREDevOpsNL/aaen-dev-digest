# reviewer-core (`@devdigest/reviewer-core`) — agent notes

Extends [`../AGENTS.md`](../AGENTS.md). Read that first; this file holds only
what is local to the engine.

## Scope

`reviewer-core/` owns prompt assembly, structured model output, review strategy
(single-pass and map-reduce), the reduce step, citation grounding, deterministic
scoring, and GitHub review-payload formatting.

## Commands

**npm, not pnpm.** This package has its own `package-lock.json`.

```sh
npm test           # vitest, hermetic, stubbed LLMProvider — no keys, no network
npm run typecheck  # tsc --noEmit — this IS the build; the package emits no JS
```

## Purity boundary

**Purity is the contract.** No database, no HTTP, no GitHub, no git, no
filesystem. The only side effect is an LLM call through an **injected**
`LLMProvider`. Anything that needs I/O belongs in `server/`, not here.

- Inputs such as skills, memory, specs, callers and the repo map must already be
  resolved by the caller. The engine never fetches them.
- Treat the diff, the PR body, and any repository-derived context as **untrusted
  data**. Fence them with `wrapUntrusted()` before they reach the prompt;
  `assemblePrompt` appends the injection guard to the system message itself, so do
  not hand-assemble a system prompt that bypasses it.
- **The grounding gate is mandatory.** A finding that does not cite a real line in
  the diff is dropped. Do not add a bypass — it is what stops hallucinated
  locations. Apply grounding after reduce, through the single shared grounding
  path.
- The score is **recomputed deterministically** from the surviving findings. The
  model's own score and verdict are never trusted.
- Preserve the cancellation checkpoints before expensive model calls; the caller
  supplies a function that throws to abort mid-run.

## Compatibility

- Consumed as TypeScript **source** through a tsconfig path alias
  (`server/tsconfig.json` maps `@devdigest/reviewer-core` to `src/index.ts`).
  Never add a build step and never import from `dist`.
- The public surface is whatever `src/index.ts` exports. Adding or changing an
  export is an API change — typecheck the `server/` consumer before you finish.
- Contracts (`Review`, `Finding`, `Verdict`, `GitHubReviewPayload`, …) come from
  `@devdigest/shared`, whose canonical copy lives in `server/src/vendor/shared/`.

## Gotchas

- `assemblePrompt` accepts optional slots (`skills`, `memory`, `specs`,
  `callers`) that the starter's caller does not fill. An omitted slot renders as
  no section; an *empty* section means a caller passed an empty value.
- `output/to-review.ts` formats a payload for a CI runner that is **not in this
  tree**. A helper written for CI does not make CI an operational feature —
  check the [product boundary](../docs/ai-context/01_PRODUCT_BOUNDARY.md).

## Skills

`typescript-expert`, `zod`, `security`.

## Read when

- Read [`LEARNINGS.md`](LEARNINGS.md) first for what was already tried here, and run
  the `engineering-insights` skill at the end of the task to add to it.
- Read [`README.md`](README.md) for the pipeline diagram and the full public API.
- Read [`docs/`](docs/README.md) before changing prompt assembly or the grounding
  heuristics.
- Read [`specs/`](specs/README.md) for intent on engine capabilities that are not
  built yet.
- Read [`../docs/agent-prompts/`](../docs/agent-prompts/README.md) when the task
  concerns a built-in agent's system prompt or model choice.
