import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

  it("shows a run-scoped, read-only tooltip with a bounded description", () => {
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
      }],
    });

    const trigger = screen.getByRole("group", { name: "Findings" });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("1 FINDINGS IN THIS RUN");
    expect(screen.getByRole("tooltip")).toHaveTextContent("⚠ WARNING Current warning · performance");
    expect(screen.getByRole("tooltip")).toHaveTextContent("src/api.ts:42 · 87%");
    expect(screen.getByRole("tooltip")).toHaveTextContent("x".repeat(179) + "…");
    expect(screen.queryByRole("button", { name: /accept|reject/i })).not.toBeInTheDocument();
    expect(screen.getByRole("tooltip").querySelector("[title]")).toBeNull();
    fireEvent.mouseLeave(trigger);
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});
