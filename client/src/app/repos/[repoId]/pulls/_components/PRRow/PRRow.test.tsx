import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(cleanup);

const PR: PrMeta = {
  id: "pr-1",
  number: 482,
  title: "Add rate limiting",
  author: "marisa",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "abc",
  additions: 10,
  deletions: 2,
  files_count: 1,
  status: "reviewed",
  updated_at: "2026-09-20T12:00:00Z",
  score: 90,
  cost_usd: 0.012,
  has_successful_review: true,
};

function renderRow(pr: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={pr} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow", () => {
  it("renders provider-reported cost, preserves unknown cost, and leaves no-run cost empty", () => {
    const { rerender } = renderRow(PR);
    expect(screen.getByText("$0.012")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <PRRow pr={{ ...PR, cost_usd: null, has_successful_review: true }} repoId="repo-1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("pr-list-cost")).toHaveTextContent("—");

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <PRRow pr={{ ...PR, cost_usd: null, has_successful_review: false }} repoId="repo-1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("pr-list-cost")).toHaveTextContent("");
  });

  it("shows each agent's latest findings read-only, naming the agent, with a bounded description", () => {
    const rationale = "x".repeat(220);
    renderRow({
      ...PR,
      findings_by_severity: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
      finding_previews: [{
        severity: "WARNING",
        title: "Current warning",
        category: "performance",
        file: "src/api.ts",
        start_line: 42,
        confidence: 0.87,
        rationale,
        agent_name: "Performance Reviewer",
      }],
    });

    const trigger = screen.getByRole("group", { name: "Findings: 1 WARNING" });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("1 FINDINGS IN LATEST AGENT RUNS");
    expect(screen.getByRole("tooltip")).toHaveTextContent("WARNING Current warning · performance · Performance Reviewer");
    expect(screen.getByRole("tooltip")).toHaveTextContent("src/api.ts:42 · 87%");
    expect(screen.getByRole("tooltip")).toHaveTextContent("x".repeat(179) + "…");
    expect(screen.queryByRole("button", { name: /accept|reject/i })).not.toBeInTheDocument();
    expect(screen.getByRole("tooltip").querySelector("[title]")).toBeNull();
    fireEvent.mouseLeave(trigger);
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("names the agent behind every aggregated finding, and an unknown agent", () => {
    const finding = { category: "bug", file: "src/api.ts", start_line: 1, confidence: 0.9, rationale: "Why." };
    renderRow({
      ...PR,
      findings_by_severity: { CRITICAL: 1, WARNING: 1, SUGGESTION: 1 },
      finding_previews: [
        { ...finding, severity: "CRITICAL", title: "Leaked key", agent_name: "Security Reviewer" },
        { ...finding, severity: "WARNING", title: "N+1 query", agent_name: "Performance Reviewer" },
        { ...finding, severity: "SUGGESTION", title: "Rename helper", agent_name: null },
      ],
    });

    fireEvent.mouseEnter(screen.getByRole("group", { name: "Findings: 1 CRITICAL, 1 WARNING, 1 SUGGESTION" }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("3 FINDINGS IN LATEST AGENT RUNS");
    expect(tooltip).toHaveTextContent("Leaked key · bug · Security Reviewer");
    expect(tooltip).toHaveTextContent("N+1 query · bug · Performance Reviewer");
    expect(tooltip).toHaveTextContent("Rename helper · bug · Unknown agent");
  });

  it("keeps the findings preview open while it scrolls, without opening the PR", () => {
    renderRow({
      ...PR,
      findings_by_severity: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
      finding_previews: [{
        severity: "WARNING",
        title: "Current warning",
        category: "performance",
        file: "src/api.ts",
        start_line: 42,
        confidence: 0.87,
        rationale: "Loop issues one query per user.",
      }],
    });

    fireEvent.mouseEnter(screen.getByRole("group", { name: "Findings: 1 WARNING" }));
    const list = screen.getByRole("tooltip").lastElementChild as HTMLElement;
    fireEvent.wheel(list, { deltaY: 120 });
    fireEvent.scroll(list, { target: { scrollTop: 120 } });
    fireEvent.mouseDown(list);
    fireEvent.mouseUp(list);
    fireEvent.click(list);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
