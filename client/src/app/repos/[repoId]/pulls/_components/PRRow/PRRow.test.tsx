import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
};

function renderRow(pr: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={pr} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow Cost", () => {
  it("renders provider-reported cost and preserves a missing cost as unknown", () => {
    const { rerender } = renderRow(PR);
    expect(screen.getByText("$0.012")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <PRRow pr={{ ...PR, cost_usd: null }} repoId="repo-1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
