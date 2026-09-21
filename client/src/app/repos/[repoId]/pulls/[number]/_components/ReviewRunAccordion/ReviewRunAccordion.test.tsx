import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json";
import { ReviewRunAccordion } from "./ReviewRunAccordion";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

afterEach(cleanup);

const REVIEW: ReviewRecord = {
  id: "review-1",
  pr_id: "pr-1",
  agent_id: "agent-1",
  run_id: "run-1",
  agent_name: "General Reviewer",
  kind: "review",
  verdict: "approve",
  summary: "Looks good",
  score: 100,
  cost_usd: 0.012,
  model: "openrouter/test",
  created_at: "2026-09-20T12:00:00Z",
  findings: [],
};

function renderReview(review: ReviewRecord) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <ReviewRunAccordion review={review} prId="pr-1" />
    </NextIntlClientProvider>,
  );
}

describe("ReviewRunAccordion Cost", () => {
  it("shows Cost next to the run time and does not coerce missing cost to zero", () => {
    const { rerender } = renderReview(REVIEW);
    expect(screen.getByText("Cost: $0.012")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <ReviewRunAccordion review={{ ...REVIEW, cost_usd: null }} prId="pr-1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Cost: —")).toBeInTheDocument();
  });
});
