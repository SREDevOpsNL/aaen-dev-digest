# e2e/specs — executable flows

This directory is the repository's one **executable** `specs/` directory: a flow
file is both the intent and the test. `run.ts` discovers flows by the `.flow.json`
suffix and runs them in filename order against one shared session, so any
Markdown here — this README included — is ignored by the runner.

Prose specs therefore live here too, next to the flows they describe, the same as
every other module's `specs/`. Put them in `written/` to keep them clearly apart
from the executable files. What belongs in [`../docs/`](../docs/README.md) instead
is how the suite works **today**.

## Flows

| Flow                             | Journey (the flow's own `name`)                                |
| -------------------------------- | ------------------------------------------------------------- |
| `01-app-boot.flow.json`          | App boots and lands on a repo's PR list                        |
| `02-repo-pulls-detail.flow.json` | Open a PR from the list and load its review detail             |
| `03-agents.flow.json`            | Agents list renders the seeded reviewer agents                 |
| `04-pr-findings.flow.json`       | PR detail shows the seeded review run, verdict, and findings   |
| `05-pr-diff.flow.json`           | PR detail Files changed tab renders the seeded diff            |
| `06-onboarding.flow.json`        | Onboarding add-repository screen renders                       |
| `07-settings.flow.json`          | Settings renders the API Keys and Feature Models sections      |
| `08-skills.flow.json`            | Skills library and Test Quality Reviewer render from seed      |
| `09-conventions.flow.json`       | Conventions Extractor opens for the seeded repository           |

Flows `01`, `02`, `04` and `05` enter at `{BASE}/` and follow the home redirect to
the **first** repo, so they assume the seeded demo repo is the only one.

## Adding a written spec

A prose spec goes in `written/NN-journey-name.md` and names the flow file that
proves it:

```markdown
# <Journey>

**Status:** draft | agreed | in progress | shipped

## Journey            <!-- the user path, in order -->
## Seed dependencies  <!-- which seeded rows the flow assumes -->
## Assertions         <!-- the wait --text / wait --url checks that prove it -->
## Flow file          <!-- ../NN-name.flow.json, once it exists -->
```

Once shipped, the flow file is the living spec. Delete the prose or set
`Status: shipped`; **stale specs are worse than missing ones**, because an agent
reads them as current intent.

## Adding a flow

- Keep the numeric prefix; the runner orders by filename.
- Deterministic locators only (`--url`, `--text`, `find role|text|label`). Never
  the AI `chat` command.
- `wait --text` / `wait --url` **are** the assertions — they exit non-zero on
  timeout.
- Read-only against seeded data (`acme/payments-api`, PR #482, the seeded agents).
  Nothing that writes, and nothing that triggers a model call.
- Verify with `npm run e2e:hermetic`, not against your dev DB.
