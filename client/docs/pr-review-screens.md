# PR review screens

What the PR list and the PR detail page show, which component owns each part,
and where its data comes from. Server-side rules are in
[`../../server/docs/`](../../server/docs/README.md); the shared popover is in
[findings-preview.md](findings-preview.md).

## PR list: `/repos/[repoId]/pulls`

[`pulls/page.tsx`](../src/app/repos/[repoId]/pulls/page.tsx) loads every PR of
the repository once with `usePulls` (`GET /repos/:id/pulls`, refetched every
60s), then filters and sorts in the browser:

- **Status tabs:** All, Needs review, Reviewed, Stale. The tab is kept in
  `?status=` and defaults to `needs_review`.
- **Search:** matches the title or the PR number.
- **Sort:** newest or oldest, by `updated_at`.
- **Refresh:** `useRefreshRepo` (`POST /repos/:id/refresh`) re-fetches the
  clone and invalidates the list. The refetch that follows syncs the PRs from
  GitHub.
- **Summary:** "N open · M need review".
- **Auto-review pill:** display-only (`AutoTriggerStatus on={false}`). The
  starter has no automatic review trigger.

Each row is a `PRRow`
([`pulls/_components/PRRow/`](../src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx));
clicking it opens the PR:

| Column | Source |
| --- | --- |
| Pull request | Title and `#number`. |
| Author | GitHub login with an avatar. |
| Size | S below 100 changed lines, M below 400, otherwise L (`sizeOf`, `pulls/constants.ts`). |
| Score | Ring for `score`, the newest successful review; `—` when never reviewed. |
| Cost | Empty when `has_successful_review` is false. Otherwise `formatUsdCost(cost_usd)`, which shows `—` when the cost is unknown. |
| Findings | `FindingsPreview` with `scope="latestAgentRuns"`: counts and previews from **each agent's latest successful run**, each finding labelled with its agent. `—` when there are none. |
| Status | Derived review status badge. |
| Updated | Relative time. |

## PR detail: `/repos/[repoId]/pulls/[number]`

[`pulls/[number]/page.tsx`](../src/app/repos/[repoId]/pulls/[number]/page.tsx)
keeps its state in the URL: `?tab=overview | findings | diff`, and
`?trace=<runId>` for the drawer.

- **Header** (`PrDetailHeader`): title, author, branches, `+/-`, status, and
  "View on GitHub".
  - **`RunReviewDropdown`** starts `POST /pulls/:id/review` for one agent or
    for all enabled agents, then switches to Agent runs.
- **Overview** (`OverviewTab`): the PR description and the L03 `IntentCard`.
  The card reads the cached intent (`usePrIntent`), generates one on first
  open when none exists, and offers Recompute.
- **Files changed** (`DiffTab`): the patch viewer. It shows GitHub
  review-comment threads, plus a composer while the PR is open.
- **Agent runs** (`FindingsTab`), from top to bottom:
  1. **Live review** (`RunStatus`): SSE logs for runs still `running`
     (`usePrActiveRuns` plus `useRunEvents`), with Cancel and Open trace.
  2. **Lethal Trifecta banner:** shown when any finding has
     `kind = 'lethal_trifecta'`.
  3. **Timeline** (`RunHistory`): every run (`usePrRuns`) interleaved with the
     PR's commits, newest first.
     - **Badge:** the run's outcome, derived deterministically
       (`outcomeOf`). In order:
       - `running`, `error`, or `cancelled` from the status;
       - otherwise `rejected` when it has blockers;
       - `reviewed` when it has findings;
       - `approved` when it has none.
     - **Tile contents:** the score ring, the agent name (click to jump to its
       Review run), and per-severity counts with a `FindingsPreview` in run
       scope. Also the blocker count, cost and time, Open trace, and Delete.
  4. **Review runs** (`ReviewRunAccordion`): one accordion per persisted review
     (`usePrReviews`), newest first, with the first one open.
     - **Header:** verdict, finding and blocker counts, cost, and timestamp.
     - **Body:** the `VerdictBanner` summary and that run's `FindingsPanel`.
- **Run trace drawer** (`RunTraceDrawer`, opened by `?trace=`):
  - configuration;
  - stats (duration, tokens, findings, cost);
  - the run's persisted findings;
  - prompt assembly, with the Skills token count (the intent a run used is
    stored in its trace but not shown in the drawer);
  - tool calls, raw output, and the full log.

## Findings panel and cards

`FindingsPanel` ([`[number]/_components/FindingsPanel/`](../src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx))
works only on the findings already loaded for its run. Filtering never sends a
request or calls a model.

- **One severity state, two controls.** The clickable Critical, Warning, and
  Suggestion count buttons and the separate filter row share it. Clicking the
  active severity again clears it.
- **Hide low confidence:** hides findings below 0.65
  (`LOW_CONFIDENCE_THRESHOLD`).
- **Order:** findings sort by severity (`visibleFindings`, `helpers.ts`).
- **Cards** (`FindingCard`):
  - severity, title, category, and confidence;
  - `file:line`, linking to the file at the PR head on GitHub;
  - rationale and suggestion;
  - **Accept** and **Dismiss** (`useFindingAction`, `POST
    /findings/:id/accept|dismiss`). These record local state only; nothing is
    posted to GitHub.

The acceptance criteria for the filter live in
[`../specs/01-severity-finding-filter.md`](../specs/01-severity-finding-filter.md).

## Tests

Most component folders above have their own `*.test.tsx` (including
`IntentCard`). `FilterBar`, `DiffTab`, `FindingsTab`, `OverviewTab`, and
`PrDetailHeader` do not yet. The
seeded browser journeys are e2e flows:

- `04`: Review runs and the severity filter.
- `05`: Files changed.
- `07a`: the Timeline findings preview.
