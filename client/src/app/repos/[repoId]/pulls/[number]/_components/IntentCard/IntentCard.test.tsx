import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { IntentAnalysis, PrIntentView } from "@devdigest/shared";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../../messages/en/prReview.json";

const ensure = vi.fn();
const recompute = vi.fn();
let view: PrIntentView | undefined;
let isError = false;

vi.mock("@/lib/hooks", () => ({
  usePrIntent: () => ({ data: view, isError, isLoading: !view && !isError }),
  useEnsurePrIntent: () => ({ mutate: ensure, isPending: false }),
  useRecomputePrIntent: () => ({ mutate: recompute, isPending: false }),
}));

import { IntentCard } from "./IntentCard";

const analysis: IntentAnalysis = {
  claimed_purpose: "Add rate limiting to the payments API",
  supported_points: [
    {
      statement: "Adds a rate limiter to the charge route",
      evidence: [{ file: "src/routes/charge.ts", side: "new", start_line: 12, end_line: 14 }],
    },
  ],
  discrepancies: [{ kind: "undeclared_change", statement: "Also changes the retry policy", evidence: [] }],
  in_scope: ["charge route throttling"],
  out_of_scope: ["refund flow"],
  confidence: "medium",
  unverified_statements: [],
};

function makeView(overrides: Partial<PrIntentView> = {}): PrIntentView {
  return {
    pr_id: "pr1",
    state: "ready",
    stale: false,
    stale_reasons: [],
    analysis,
    head_sha: "h1",
    current_head_sha: "h1",
    linked_issue: null,
    evidence: { files_listed: 2, files_excerpted: 2, truncated: false, invalid_citations: 0 },
    provider: "openrouter",
    model: "deepseek-flash",
    derived_at: "2026-10-14T10:00:00Z",
    tokens_in: 300,
    tokens_out: 80,
    provider_cost_usd: 0.0004,
    last_error: null,
    last_attempt_at: "2026-10-14T10:00:00Z",
    ...overrides,
  };
}

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <IntentCard prId="pr1" />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  beforeEach(() => {
    ensure.mockReset();
    recompute.mockReset();
    isError = false;
    view = undefined;
  });
  afterEach(cleanup);

  it("generates once on first open when nothing is cached", () => {
    view = makeView({ state: "missing", analysis: null });
    const { rerender } = renderCard();
    expect(screen.getByText("Deriving PR intent…")).toBeTruthy();
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith("pr1");
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <IntentCard prId="pr1" />
      </NextIntlClientProvider>,
    );
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Recompute" })).toBeNull();
  });

  it("shows a fresh intent without generating again", () => {
    view = makeView();
    renderCard();
    expect(ensure).not.toHaveBeenCalled();
    expect(screen.getByText("Add rate limiting to the payments API")).toBeTruthy();
    expect(screen.getByText(/Adds a rate limiter to the charge route/)).toBeTruthy();
    expect(screen.getByText(/src\/routes\/charge\.ts:L12/)).toBeTruthy();
    expect(screen.getByText("charge route throttling")).toBeTruthy();
    expect(screen.getByText("refund flow")).toBeTruthy();
    expect(screen.getByText(/Change not mentioned by the author: Also changes the retry policy/)).toBeTruthy();
    expect(screen.getByText("Medium confidence")).toBeTruthy();
    expect(screen.getByText(/Derived with deepseek-flash/)).toBeTruthy();
    expect(screen.getByText(/classifier cost \$0\.0004/)).toBeTruthy();
    expect(screen.queryByText("Stale")).toBeNull();
  });

  it("shows stale intent with its reasons and recomputes only on request", () => {
    view = makeView({ stale: true, stale_reasons: ["head_changed", "context_changed"], current_head_sha: "h2" });
    renderCard();
    expect(screen.getByText("Stale")).toBeTruthy();
    expect(screen.getByText(/new commits since it was derived; title, description, files or linked issue changed/)).toBeTruthy();
    expect(recompute).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));
    expect(recompute).toHaveBeenCalledWith("pr1");
  });

  it("keeps the previous intent visible when the last recompute failed", () => {
    view = makeView({ last_error: "classifier timed out" });
    renderCard();
    expect(screen.getByText(/Last recompute failed: classifier timed out/)).toBeTruthy();
    expect(screen.getByText(/Adds a rate limiter to the charge route/)).toBeTruthy();
  });

  it("marks low confidence as context only and lists unverified statements", () => {
    view = makeView({
      analysis: {
        ...analysis,
        confidence: "low",
        supported_points: [],
        unverified_statements: [
          { statement: "Fixes a race in refunds", origin: "supported_point", reason: "lines_not_sampled" },
        ],
      },
      provider_cost_usd: null,
    });
    renderCard();
    expect(screen.getByText("Low confidence")).toBeTruthy();
    expect(screen.getByText(/Used as context only/)).toBeTruthy();
    expect(screen.getByText("Nothing in the changes could be confirmed.")).toBeTruthy();
    expect(screen.getByText("Fixes a race in refunds")).toBeTruthy();
    expect(screen.getByText(/classifier cost not reported/)).toBeTruthy();
  });

  it("explains a missing key and a failed derivation, each with Recompute", () => {
    view = makeView({ state: "skipped_no_key", analysis: null, last_error: "OPENAI_API_KEY is not configured" });
    renderCard();
    expect(screen.getByText(/No API key is set for the configured intent model/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recompute" })).toBeTruthy();
    cleanup();

    view = makeView({ state: "failed", analysis: null, last_error: "provider exploded" });
    renderCard();
    expect(screen.getByText(/The intent could not be derived: provider exploded/)).toBeTruthy();
    expect(ensure).not.toHaveBeenCalled();
  });

  it("shows the linked issue and a load error", () => {
    view = makeView({ linked_issue: { number: 12, title: "Throttle charges" } });
    renderCard();
    expect(screen.getByText("Linked issue #12: Throttle charges")).toBeTruthy();
    cleanup();

    view = undefined;
    isError = true;
    renderCard();
    expect(screen.getByText("Couldn't load the PR intent.")).toBeTruthy();
  });
});
