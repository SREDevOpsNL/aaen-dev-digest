# Engineering Insights

## What Works

- **2026-09-28** — Run-scoped severity filters derive counts from already loaded findings and update only client state. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts:5`.

- **2026-09-30** — A visually truncated finding preview can still expose the
full rationale through a title attribute. Keep the PR-list popup description
bounded in the response and render it without a full-text tooltip; the stored
finding rationale remains unchanged. Evidence:
client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:93,
client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.test.tsx:81.

## What Doesn't Work

- **2026-10-02** — Deriving L01 acceptance only from the decks and a
paraphrased rubric missed the Timeline half of the findings preview. The
decks say just "severity filter"; the detail lives in the lab design bundle
(`Lesson 01/Lab 01/DevDigest Design (standalone).html`), whose
`prdetail_runs.jsx` gives each Timeline run tile colored severity counts with
a `FindingsTooltip`, and whose `screen_dashboard.jsx` reuses that tooltip in
the PR list. Unpack the bundle's `__bundler/manifest` (base64, gzip) and read
the screen source before calling a UI requirement complete. Evidence:
client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:217.

## Codebase Patterns & Tool / Library Notes

- **2026-10-02** — Correction to the 2026-09-30 title-attribute entry: the
PR-list preview now renders through the shared FindingsPreview, which the
Timeline also uses; the evidence moved from PRRow.tsx to
client/src/app/repos/[repoId]/pulls/_components/FindingsPreview/FindingsPreview.tsx:95
and FindingsPreview.test.tsx:60.

## Decisions

## Recurring Errors & Fixes
- **2026-09-28** — L01 requires both clickable run-scoped severity count buttons and a separate Critical/Warning/Suggestion filter row. Keep both controls on the same severity state and toggle handler. Evidence: client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:75 (FindingsPanel), e2e/specs/04-pr-findings.flow.json:17.

- **2026-10-02** — The PR-list container clips absolutely positioned children,
so the first PR-list findings popup showed only a thin strip under the row in a
real browser while every jsdom test passed. Anchor row popovers with
`position: fixed` from the trigger's bounding rect, close them on scroll, and
check popovers in a browser, not only in component tests. Evidence:
client/src/app/repos/[repoId]/pulls/_components/FindingsPreview/helpers.ts:17,
client/src/app/repos/[repoId]/pulls/styles.ts:94.


## Session Notes

## Open Questions
