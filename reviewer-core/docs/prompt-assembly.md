# Prompt assembly

What the model receives for one review call, and how untrusted PR content is
kept from acting as instructions. The code is
[`src/prompt.ts`](../src/prompt.ts). The built-in agents' system prompts are
documented in [`docs/agent-prompts/`](../../docs/agent-prompts/README.md); this
document does not copy them.

## Messages

`assemblePrompt(parts)` (`prompt.ts:85`) returns exactly two chat messages and
a `PromptAssembly` record for the run trace.

**The system message** is the agent's system prompt followed by
`INJECTION_GUARD` (`prompt.ts:16`). It is the only trusted text.

**The user message** is made of these sections, in this order. Each one is
omitted when its input is empty:

| # | Section | Input | Wrapping |
| --- | --- | --- | --- |
| 1 | task line | `task`, e.g. "Review PR #482 …" | none |
| 2 | `## PR description` | `prDescription`, cut to 4,000 characters (`MAX_PR_DESCRIPTION_CHARS`) | `untrusted source="pr-description"` |
| 3 | `## Skills / rules` | `skills[]`, joined | none |
| 4 | `## Relevant memory` | `memory[]`, as bullets | none |
| 5 | `## Repo skeleton` | `repoMap` | `untrusted source="repo-map"` |
| 6 | `## Project context` | `specs[]` | each `untrusted source="spec-<i>"` |
| 7 | `## Callers of changed symbols` | `callers` | `untrusted source="callers"` |
| 8 | `## Diff to review` | the diff, or one file's slice in map-reduce | `untrusted source="diff"` |

The order is deliberate: the model reads what the PR claims, then the context,
and the diff last.

**What the studio passes today**
([`run-executor.ts`](../../server/src/modules/reviews/run-executor.ts)):

- the task line, the PR body, and the diff;
- when the agent's repo-intel toggle is on **and** the repository is indexed,
  the repo map and the callers digest.

Skills, memory, and specs are extension points for later lessons. Their slots
exist, but the starter studio never fills them (see the
[product boundary](../../docs/ai-context/01_PRODUCT_BOUNDARY.md)).

## Untrusted content

- **Fencing:** `wrapUntrusted(label, content)` (`prompt.ts:30`) wraps content in
  `<untrusted source="…">…</untrusted>`, and escapes any `</untrusted>` inside
  it as `<\/untrusted>`, so a PR cannot close the fence early.
- **One rule:** the guard tells the model that everything inside the fences is
  data, never instructions. It also says that claims such as "test fixture",
  "intentional", "demo", or "do not flag", **in any language**, never descope
  the review: real defects are reported at their true severity.
- **No keyword filtering:** the defense is that one trusted rule. Filtering
  untrusted text for phrases would catch only the phrasings someone thought
  of.
- **Not fenced:** skill and memory blocks are treated as curated, trusted-ish
  input, so community skills must be sanitised **before** they reach the engine.

## Budget

The engine caps only the PR description (4,000 characters). Everything else
is bounded by its producer:

- the server token-budgets the repo map through repo-intel;
- the callers digest holds at most 10 caller signatures
  (`getCallerSignatures(…, 10)` in `run-executor.ts`);
- a large diff is split into per-file calls by map-reduce
  ([review engine → steps](review-engine.md#steps)), never truncated.

## The trace record

`PromptAssembly` stores the final system message, each optional block (or
`null`), and the full user message. The studio persists it in the run trace
(`prompt_assembly`), and the trace drawer's "Prompt assembly" section shows it
verbatim. That is the way to check what a given run actually sent.

## Tests

`test/prompt.test.ts` covers:

- the guard is appended, and forbids descoping by stated intent;
- the PR-description section is wrapped, ordered before the diff, omitted when
  blank, and truncated at 4,000 characters.
