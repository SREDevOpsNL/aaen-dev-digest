# docs/ — cross-package

Reference material describing how the system works **today**, across more than
one package. Human-first prose and diagrams; agents read it on demand via the
`Read when` pointers in [`../CLAUDE.md`](../CLAUDE.md).

## Canonical product context

These three are the highest-authority documents in the repository after the
source itself. Link to them; never copy them.

| Path                                                             | What                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------- |
| [`ai-context/00_PRODUCT_IDENTITY.md`](ai-context/00_PRODUCT_IDENTITY.md) | Stable product truth — what DevDigest is      |
| [`ai-context/01_PRODUCT_BOUNDARY.md`](ai-context/01_PRODUCT_BOUNDARY.md) | Which capabilities are operational vs scaffolded |
| [`architecture/00_ARCHITECTURE_OVERVIEW.md`](architecture/00_ARCHITECTURE_OVERVIEW.md) | Cross-module technical source of truth |

## Other cross-package material

| Path                                          | What                                                             |
| --------------------------------------------- | ---------------------------------------------------------------- |
| [`agent-prompts/`](agent-prompts/README.md)   | System prompts for the built-in reviewers + model-choice notes    |
| [`course-data/course-notes.md`](course-data/course-notes.md) | Course framing; reference material, not a source of truth         |

## Module documentation

Package-local reference material goes in `<package>/docs/`:

- [client](../client/docs/README.md)
- [server](../server/docs/README.md)
- [reviewer-core](../reviewer-core/docs/README.md)
- [e2e](../e2e/docs/README.md)

## Specifications

Intent lives in `specs/`, not here:

- [Cross-package specs](../specs/README.md)
- [client](../client/specs/README.md) ·
  [server](../server/specs/README.md) ·
  [reviewer-core](../reviewer-core/specs/README.md) ·
  [e2e](../e2e/specs/README.md)

## Rules

- Do not restate `README.md`. Link to it.
- Do not put intent here — that is `specs/`. Do not put rejected approaches here
  — that is `LEARNINGS.md`.
- If a doc goes stale, delete it. A wrong doc costs more than a missing one,
  because `CLAUDE.md` points agents at it as curated truth.
