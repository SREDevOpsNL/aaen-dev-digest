/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f-1",
    review_id: "review-1",
    severity: "WARNING",
    category: "bug",
    title: "Inclusive date range",
    file: "src/repo.ts",
    start_line: 57,
    end_line: 57,
    rationale: "Upper bound is inclusive.",
    confidence: 0.85,
    kind: "finding",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

describe("RunHistory — severity counts and findings preview", () => {
  const findingsByRun = {
    "run-1": [
      finding({ id: "f-1", severity: "CRITICAL", title: "Unauthenticated endpoint", category: "security" }),
      finding({ id: "f-2" }),
      finding({ id: "f-3", title: "Untested service" }),
    ],
  };

  function renderWithFindings(r: RunSummary) {
    return render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory runs={[r]} findingsByRun={findingsByRun} onOpenTrace={() => {}} />
      </NextIntlClientProvider>,
    );
  }

  it("replaces the finding total with per-severity counts and keeps blockers", () => {
    renderWithFindings(run({ findings_count: 3, blockers: 1, score: 17 }));
    expect(screen.getByRole("group", { name: "Findings: 1 CRITICAL, 2 WARNING" })).toBeInTheDocument();
    expect(screen.queryByText(/3 finding/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();
  });

  it("previews this run's findings on hover without an action control", () => {
    renderWithFindings(run({ findings_count: 3, blockers: 1, score: 17 }));
    fireEvent.mouseEnter(screen.getByRole("group", { name: /^Findings/ }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("3 FINDINGS IN THIS RUN");
    expect(tooltip).toHaveTextContent("CRITICAL Unauthenticated endpoint · security");
    expect(tooltip).toHaveTextContent("Untested service");
    expect(tooltip.querySelector("button")).toBeNull();
  });

  it("falls back to the server's per-run counts, without a preview, before reviews load", () => {
    renderRuns([
      run({
        run_id: "run-2",
        findings_count: 2,
        severity_counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 2 },
      }),
    ]);
    const group = screen.getByRole("group", { name: "Findings: 2 SUGGESTION" });
    fireEvent.mouseEnter(group);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
