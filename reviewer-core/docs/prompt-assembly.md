# Prompt assembly

What the model receives for one review call, and how untrusted PR content is
kept from acting as instructions. The code is
[`src/prompt.ts`](../src/prompt.ts). The built-in agents' system prompts are
documented in [`docs/agent-prompts/`](../../docs/agent-prompts/README.md); this
document does not copy them.

## Messages

`assemblePrompt(parts)` (`prompt.ts:85`) returns exactly two chat messages and
a `PromptAssembly` record for the run trace.

**The system message** is, in this order:

1. the agent's system prompt (trusted);
2. when skills are linked, the `## Skills / rules` section exactly as
   `renderSkillsSection(skills)` renders it: a heading, a short preamble, and
   each skill body fenced as `untrusted source="skill-<i>"`, in the order the
   caller passed (the studio passes the persisted link order);
3. `INJECTION_GUARD`, always last.

With no skills (`skills` undefined or empty) the system message is the agent's
system prompt followed by the guard, byte for byte as before skills moved
here. `renderSkillsSection` is the only renderer of the section; the studio's
`skills_tokens` counts its `section` once.

**The user message** is made of these sections, in this order. Each one is
omitted when its input is empty. It never contains the Skills section:

| # | Section | Input | Wrapping |
| --- | --- | --- | --- |
| 1 | task line | `task`, e.g. "Review PR #482 …" | none |
| 2 | `## PR description` | `prDescription`, cut to 4,000 characters (`MAX_PR_DESCRIPTION_CHARS`) | `untrusted source="pr-description"` |
| 3 | `## Relevant memory` | `memory[]`, as bullets | none |
| 4 | `## Repo skeleton` | `repoMap` | `untrusted source="repo-map"` |
| 5 | `## Project context` | `specs[]` | each `untrusted source="spec-<i>"` |
| 6 | `## Callers of changed symbols` | `callers` | `untrusted source="callers"` |
| 7 | `## Diff to review` | the diff, or one file's slice in map-reduce | `untrusted source="diff"` |

Both the single-pass call and every per-file map-reduce call go through
`assemblePrompt`, so each request carries the Skills section in its system
message.

The order is deliberate: the model reads what the PR claims, then the context,
and the diff last.

**What the studio passes today**
([`run-executor.ts`](../../server/src/modules/reviews/run-executor.ts)):

- the task line, the PR body, and the diff;
- when the agent's repo-intel toggle is on **and** the repository is indexed,
  the repo map and the callers digest.

- the agent's enabled linked skills, in link order.

Memory and specs are extension points for later lessons. Their slots exist,
but the starter studio never fills them (see the
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
- **Skills are fenced too:** although they sit in the system message, each
  skill body is wrapped as untrusted data, and a body cannot close its fence,
  add a message, or add a section outside it: the request is always exactly
  one system and one user message.
- **Not fenced:** memory is treated as curated, trusted-ish input.
- **A policy, not a guarantee:** the delimiters and the guard tell the model
  how to treat the fenced text. They do not guarantee injection resistance: a
  model can still follow text inside a fence, and skill text in the system
  message carries system-level weight. Who may author or change a skill body
  must therefore be controlled outside the engine.

## Budget

The engine caps only the PR description (4,000 characters). Everything else
is bounded by its producer:

- the server token-budgets the repo map through repo-intel;
- the callers digest holds at most 10 caller signatures
  (`getCallerSignatures(…, 10)` in `run-executor.ts`);
- a large diff is split into per-file calls by map-reduce
  ([review engine → steps](review-engine.md#steps)), never truncated.

## The trace record

`PromptAssembly` stores the final system message (Skills section included),
each optional block (or `null`; `skills` is the fenced block alone), and the
full user message. Traces written before this change carry the Skills section
in `user` instead. The studio persists it in the run trace
(`prompt_assembly`), and the trace drawer's "Prompt assembly" section shows it
verbatim. That is the way to check what a given run actually sent.

## Tests

`test/prompt.test.ts` covers:

- the guard is appended, and forbids descoping by stated intent;
- the PR-description section is wrapped, ordered before the diff, omitted when
  blank, and truncated at 4,000 characters;
- a no-skill prompt is byte-for-byte the pre-change golden; with skills the
  system message is instructions → Skills section → guard, the section appears
  exactly once, order is preserved, and a hostile skill body stays in its
  fence.

`test/run.test.ts` captures the provider requests and checks that Skills are in
`messages[0]` and absent from `messages[1]` for single-pass and for every
map-reduce call.
