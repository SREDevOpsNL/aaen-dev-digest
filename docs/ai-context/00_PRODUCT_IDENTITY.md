# DevDigest Product Identity

> **Document role:** Canonical, stable product context for people and AI agents.
> **Last verified:** 2026-09-17 against `main` at
> `c6af1e452969dcad9f451e29c0a4e461a41405ae`.
> Implementation detail belongs in
> [`docs/architecture/`](../architecture/00_ARCHITECTURE_OVERVIEW.md); current
> capability limits belong in
> [`01_PRODUCT_BOUNDARY.md`](./01_PRODUCT_BOUNDARY.md).

## Canonical definition

> DevDigest is a local-first AI pull-request review studio. Despite the name,
> the current operational product is primarily a PR reviewer; weekly digest
> functionality is scaffolded but not yet operational.

DevDigest helps a developer connect a GitHub repository, inspect its pull
requests, run configurable AI reviewer agents, and turn model output into
structured, line-grounded findings that can be evaluated by a human.

It is also a teaching product. The repository is deliberately structured so
later course stages can add capabilities such as skills, project context,
evaluation, CI integration, memory, plugins, dashboards, and digests without
replacing the initial review workflow.

## Primary product job

The product's current job is:

> Help a developer review a GitHub pull request with specialised AI agents while
> retaining local control over repository state, review history, configuration,
> and evidence about how a result was produced.

The operational user journey is:

1. Configure a GitHub token and at least one supported LLM provider.
2. Add a GitHub repository.
3. Let DevDigest clone and index that repository locally.
4. Browse imported pull requests and inspect a PR's description and diff.
5. Run one reviewer agent or all enabled reviewer agents.
6. Inspect grounded findings, scores, live progress, and the persisted run trace.
7. Accept or dismiss findings locally and, separately, write inline GitHub
   review comments from the Files view.

## Product principles

### Local-first, not fully offline

DevDigest keeps its Postgres data, repository clones, settings, review history,
and user-entered secrets under local control. It is not an offline inference
system:

- GitHub repository and pull-request operations call GitHub.
- Review prompts send the selected PR diff and any enabled contextual material
  to the configured OpenAI, Anthropic, or OpenRouter model.
- Contextual material can include PR prose, code signatures, caller
  relationships, and a compact repository map derived from source code.

Therefore, “local-first” must not be presented as “source code never leaves the
machine.”

### Evidence over opaque model output

Model output is not accepted directly as product truth. Review findings are
validated against the actual changed files and lines, and the displayed quality
score is derived from findings that survive that validation.

### Human review remains authoritative

An AI finding is a proposed review observation. Accepting or dismissing it
records a local human decision; accepting it does not automatically publish a
GitHub comment or approve/request changes on the pull request.

### Agents are configuration, not autonomous identities

In the current product, an agent is versioned review configuration: provider,
model, system prompt, review strategy, severity gate, repository-intelligence
toggle, and enabled state. Agents do not independently schedule work or act on
GitHub.

## Canonical terminology

| Term | Meaning in DevDigest |
| --- | --- |
| **Repository** | A GitHub repository registered in DevDigest and normally cloned locally. |
| **Pull request** | GitHub PR metadata and detail imported into the local database. |
| **Agent** | Versioned configuration for one specialised LLM review pass. |
| **Run** | One execution of one agent against one PR revision. |
| **Review** | The persisted summary, verdict, deterministic score, and grounded findings produced by a successful run. |
| **Finding** | A structured, file-and-line-cited issue that survived the grounding gate. |
| **Accept / dismiss** | Local disposition of a finding; neither action posts to GitHub. |
| **Inline comment** | A comment authored in the Files view and posted directly to GitHub. |
| **Repo intelligence** | A local JS/TS index that supplies repository structure, file importance, and caller context to reviews. |
| **Run trace** | Persisted execution evidence: configuration, prompt assembly, events, model output, token counts, and grounding result. |

## What the name does not currently promise

“DevDigest” does not currently mean that the application produces a scheduled
weekly engineering digest. A `digests` table and related future-facing schema
exist, but no registered server module or primary UI workflow creates or
delivers weekly digests.

Similarly, the presence of a table, shared contract, prompt slot, UI placeholder,
or helper function is not by itself proof that a feature is operational. The
current feature boundary is maintained in
[`01_PRODUCT_BOUNDARY.md`](./01_PRODUCT_BOUNDARY.md).

## Sources of truth

When documents and implementation disagree, use this order:

1. Registered runtime modules and reachable UI/API behavior.
2. Review-engine and repository-intelligence implementation.
3. Database migrations and schema for storage shape, not feature availability.
4. These canonical context and architecture documents.
5. Package READMEs and course material, which may describe planned lesson
   stages or an earlier starter state.

Primary implementation anchors:

- [`server/src/modules/index.ts`](../../server/src/modules/index.ts) — active API modules.
- [`client/src/vendor/ui/nav.ts`](../../client/src/vendor/ui/nav.ts) — active primary navigation.
- [`server/src/modules/reviews/run-executor.ts`](../../server/src/modules/reviews/run-executor.ts) — studio review execution.
- [`reviewer-core/src/review/run.ts`](../../reviewer-core/src/review/run.ts) — reusable review pipeline.
