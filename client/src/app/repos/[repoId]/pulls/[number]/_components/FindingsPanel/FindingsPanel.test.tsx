import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query",
    file: "src/users.ts",
    start_line: 25,
    end_line: 28,
    rationale: "A query runs for every user.",
    suggestion: null,
    confidence: 0.85,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f3",
    severity: "SUGGESTION",
    category: "style",
    title: "Extract helper",
    file: "src/users.ts",
    start_line: 40,
    end_line: 45,
    rationale: "The logic can be named.",
    suggestion: null,
    confidence: 0.5,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel", () => {
  it("shows severity counts and filters the findings when a counter is toggled", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);

    expect(
      screen.getByRole("group", { name: "Filter findings by severity" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 CRITICAL" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "1 WARNING" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 SUGGESTION" })).toBeInTheDocument();
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Extract helper")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1 WARNING" }));

    expect(screen.getByRole("button", { name: "1 WARNING" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Extract helper")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1 WARNING" }));

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Extract helper")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1 SUGGESTION" }));
    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});
