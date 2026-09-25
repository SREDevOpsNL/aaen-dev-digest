# Conventions Extractor

**Status:** implemented and verified (2026-09-25)  
**Packages touched:** server, client, shared contracts, seed-aware browser coverage  
**Related:** [Skills for Review Agents](01-skills-for-review-agents.md)

## Problem

Review agents can reuse explicit guidance through Skills, but a maintainer may
not have written down the repository-specific patterns that reviewers should
enforce. DevDigest needs a bounded workflow that samples an already cloned and
indexed repository, asks one configured model to propose house rules, verifies
every cited example against the sampled source, and lets the maintainer triage
the grounded candidates before turning accepted rules into an ordinary Skill.

The model proposes; application code chooses the source material, verifies the
evidence, and owns persistence.

```text
code-selected sample -> one structured model call -> mechanical evidence gate
                                                   -> pending candidates
                                                   -> human triage
                                                   -> editable skill draft
```

## Scope

### In scope

- Sample bounded configuration/documentation files plus ranked source files
  from a repository clone.
- Render the sample with stable one-based line numbers and send it in one
  structured extraction request using the `conventions` feature model.
- Drop proposed rules whose cited path or snippet cannot be grounded in the
  exact sampled content; correct a miscounted line when the snippet is real.
- Persist grounded candidates as `pending` and retain prior `accepted` and
  `rejected` decisions across a re-scan.
- List, filter, edit, accept, reject, and delete repository-scoped candidates.
- Build an editable, unpersisted Skill draft from accepted candidates, then use
  the existing Skills API to create the Skill and optionally link it to an
  agent.
- Show extraction counters so discarded hallucinations and duplicates are
  distinguishable from an extraction failure.

### Out of scope

- Letting a model browse the clone, choose arbitrary files, execute tools, or
  write directly to the database.
- Treating model confidence as proof that a rule is true.
- Automatically enabling, attaching, or executing an extracted Skill without
  explicit user confirmation.
- Creating a second Skills persistence path or silently replacing an agent's
  existing ordered skill links.
- Scanning on a schedule, mining Git history/review comments, whole-repository
  frequency analysis, counterexample search, or learning from rejected rules.
- Claiming extraction is offline: sampled repository content is sent to the
  selected external model provider.

## Decisions and invariants

1. Sampling is deterministic application code, never a model call. Missing
   preferred config files are skipped, and the ranked source sample comes from
   the repo-intelligence facade.
2. Sampling is bounded per file and for the full request. Files are displayed
   with one-based line-number gutters so citations can be checked.
3. Proposal uses one `completeStructured` call at low temperature and caps the
   number of candidates. Empty readable input fails before a model call.
4. The evidence gate is mechanical. The cited path must identify one sampled
   file, the snippet must be substantial, and normalized snippet text must be
   present in that file.
5. Displayed evidence is sliced back out of the sampled file. Model-provided
   evidence text is never presented as source truth.
6. An incorrect line is corrected to the nearest real occurrence. Ambiguous
   path matches and absent snippets are dropped instead of guessed.
7. Candidates are deduplicated against the current proposal set and all prior
   decided rules. A re-scan replaces only `pending` rows.
8. Triage uses `pending`, `accepted`, and `rejected`, rather than a boolean, so
   rejection remains durable across re-scans.
9. Every read and mutation is scoped through the current workspace and
   repository. Cross-workspace identifiers behave as not found.
10. Skill generation returns a draft and does not write a Skill. The existing
    `POST /skills` route remains the only creation path and starts extracted
    drafts disabled until the user opts in.

## Data model

The existing `conventions` table is extended from starter scaffolding into the
candidate store. Each row includes:

- workspace and repository ownership;
- rule and optional rationale;
- category;
- evidence path, application-verified snippet, and verified one-based line;
- bounded model confidence;
- triage status;
- creation time for deterministic ordering.

Category and status values require database constraints as well as TypeScript
enums. The schema change is generated from the current schema state; the old
`641b637` migration sequence is reference material and must not be replayed.

## Shared contracts

The canonical contracts are changed under `server/src/vendor/shared/` first and
then mirrored to `client/src/vendor/shared/`:

```ts
ConventionCategory =
  | "naming"
  | "structure"
  | "errors"
  | "testing"
  | "imports"
  | "typing"
  | "api"
  | "general";

ConventionStatus = "pending" | "accepted" | "rejected";

ConventionCandidate = {
  id: string;
  repo_id: string | null;
  rule: string;
  rationale: string | null;
  category: ConventionCategory;
  evidence_path: string;
  evidence_snippet: string;
  evidence_line: number | null;
  confidence: number;
  status: ConventionStatus;
  created_at: string | null;
};

ConventionExtractResult = {
  candidates: ConventionCandidate[];
  sampled_files: string[];
  proposed: number;
  dropped_ungrounded: number;
  dropped_duplicate: number;
  model: string;
  cost_usd: number | null;
};

ConventionSkillDraft = {
  name: string;
  description: string;
  type: "convention";
  body: string;
  evidence_files: string[];
  convention_ids: string[];
};
```

## Server behavior

The feature follows route → service → repository ownership. Routes validate
transport input, the service owns sampling/proposal/verification, and the
repository owns only workspace-scoped convention persistence.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/repos/:id/conventions` | List repository candidates. |
| `POST` | `/repos/:id/conventions/extract` | Sample, propose once, verify, deduplicate, and replace pending candidates. |
| `POST` | `/repos/:id/conventions/skill` | Return a Skill draft from accepted candidates; write nothing. |
| `PATCH` | `/conventions/:id` | Change status and/or editable rule/rationale. |
| `DELETE` | `/conventions/:id` | Delete one candidate. |

Extraction uses `FEATURE_MODELS.conventions` through the existing feature-model
resolver. The response reports provider cost when available but does not invent
a price when the provider does not report one.

Repository content, including instructions embedded in source or Markdown, is
untrusted input. It is delimited in the extraction prompt and cannot change the
structured response schema, sampling policy, evidence checks, or application
permissions.

## Client behavior

- The repository-scoped route `/repos/:repoId/conventions` is reachable from
  the active repository navigation.
- Empty, loading, extraction-in-progress, error, and populated states are
  explicit.
- Extraction is a mutation because it incurs an external model request; its
  response refreshes the candidate list and displays the proposal/drop counts.
- Status filters expose pending, accepted, and rejected candidates without
  hiding prior decisions.
- A candidate card shows category, rule, rationale, verified `path:line`, source
  snippet, confidence, and triage/edit/delete controls.
- “Create Skill” is available only when at least one candidate is accepted. The
  modal exposes an editable draft and persists it only through `POST /skills`.
- Optional agent linking uses the additive skill-link contract and must not
  replace or reorder unrelated existing links.

## Testing

### Server unit

- Sample rendering, per-file/full-sample limits, and line-number gutters.
- Exact and unique-suffix path matching; ambiguous paths are rejected.
- Minimum snippet substance, normalized snippet matching, nearest-occurrence
  line correction, and source re-slicing.
- Candidate and decided-rule deduplication.
- Deterministic Skill body and evidence-file assembly.

### Server integration

- Workspace/repository scoping for every route.
- Grounded proposals persist while invented evidence is dropped and counted.
- Re-scan replaces pending rows but preserves accepted/rejected rows.
- Candidate edits and triage survive reads.
- Accepted candidates produce a draft that the existing Skills API can persist.
- No readable sample and no accepted candidates return bounded client errors.

### Client

- Status filtering/counts and summary presentation.
- Candidate accept/reject/edit/delete interactions.
- Extraction pending/error/success states.
- Skill modal gating, editable draft, persistence, and optional additive link.

### Browser

A deterministic read-only flow opens the seeded repository's Conventions page
and verifies its empty state and extraction affordance. It does not click “Run
extraction,” call a live model, or mutate seeded data. Server integration and
client interaction suites carry the write-path acceptance evidence.

## Acceptance criteria

1. The registered API and repository-scoped page are reachable in the running
   application.
2. Sampling is bounded and code-selected; exactly one configured structured
   model call proposes candidates per extraction request.
3. Only mechanically grounded evidence is persisted and displayed, with real
   source text and corrected line numbers.
4. Re-scanning preserves accepted/rejected decisions and replaces only pending
   candidates.
5. Users can review and edit candidates through all three triage states.
6. Accepted candidates create an editable disabled Skill draft, which is saved
   through the existing Skills workflow and can be additively linked to an
   agent.
7. Contracts remain synchronized server-first, and the generated migration
   matches the current schema history.
8. Client and server typechecks, hermetic unit suites, database-backed
   integration tests, and the hermetic browser suite pass.
9. The product boundary moves Conventions to **Operational** only after item 8
   and an end-to-end runtime path are verified.

## Deferred improvements

- Diversity-aware and test-aware sampling.
- Code-selected candidate paths ranked by a cheap model before extraction.
- Repository-wide frequency and counterexample evidence.
- Git-history and prior-review evidence.
- Contradiction checks against existing Skills.
- Scheduled rescans and feedback from rejected rules or dismissed findings.
