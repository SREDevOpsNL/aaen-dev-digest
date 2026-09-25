import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ConventionCandidate, ConventionExtractResult } from "@devdigest/shared";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en/conventions.json";

const extract = vi.fn();
const update = vi.fn();
const draftSkill = vi.fn();
let candidates: ConventionCandidate[] = [];

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" } }),
  useRepoNotFound: () => false,
}));
vi.mock("../../../../lib/hooks", () => ({
  useConventions: () => ({ data: candidates, isLoading: false, isError: false, refetch: vi.fn() }),
  useExtractConventions: () => ({ mutateAsync: extract, isPending: false }),
  useUpdateConvention: () => ({ mutate: update, isPending: false }),
  useDeleteConvention: () => ({ mutate: vi.fn(), isPending: false }),
  useConventionSkillDraft: () => ({ mutateAsync: draftSkill, isPending: false }),
}));
vi.mock("./_components/CreateSkillModal", () => ({
  CreateSkillModal: ({ acceptedCount }: { acceptedCount: number }) => <div>modal open · {acceptedCount} accepted</div>,
}));

import ConventionsPage from "./page";
import { ToastProvider } from "../../../../lib/toast";

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ToastProvider><ConventionsPage /></ToastProvider>
    </NextIntlClientProvider>,
  );
}

const candidate = (id: string, status: ConventionCandidate["status"]): ConventionCandidate => ({
  id,
  repo_id: "r1",
  category: "errors",
  rule: `rule ${id}`,
  rationale: null,
  evidence_path: "src/api/users.ts",
  evidence_line: 3,
  evidence_snippet: "throw new NotFoundError();",
  confidence: 0.8,
  status,
  created_at: null,
});

const scan: ConventionExtractResult = {
  candidates: [candidate("a", "pending")],
  sampled_files: ["package.json", "src/api/users.ts"],
  proposed: 5,
  dropped_ungrounded: 3,
  dropped_duplicate: 1,
  model: "gpt-4.1",
  cost_usd: 0.004,
};

beforeEach(() => {
  candidates = [];
  extract.mockReset();
  update.mockReset();
  draftSkill.mockReset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConventionsPage", () => {
  it("offers extraction and reports evidence-gate results", async () => {
    extract.mockResolvedValue(scan);
    renderPage();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Run extraction")[0]!);
    await waitFor(() => expect(extract).toHaveBeenCalledWith("r1"));
    expect(await screen.findByText(/3 dropped without evidence, 1 already decided/)).toBeInTheDocument();
  });

  it("filters triage states and patches only the selected candidate", () => {
    candidates = [candidate("a", "pending"), candidate("b", "accepted")];
    renderPage();
    fireEvent.click(screen.getByText("Accept"));
    expect(update).toHaveBeenCalledWith({ repoId: "r1", id: "a", patch: { status: "accepted" } });
    fireEvent.click(screen.getByText("Accepted"));
    expect(screen.getByText("rule b")).toBeInTheDocument();
    expect(screen.queryByText("rule a")).not.toBeInTheDocument();
  });

  it("creates a draft from the selected accepted subset", async () => {
    candidates = [candidate("a", "accepted"), candidate("b", "accepted")];
    draftSkill.mockResolvedValue({ name: "payments-api-conventions", description: "one rule", type: "convention", body: "# body", evidence_files: ["src/api/users.ts"], convention_ids: ["a"] });
    renderPage();
    fireEvent.click(screen.getByText("Accepted"));
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getByText("Create skill"));
    await waitFor(() => expect(draftSkill).toHaveBeenCalledWith({ repoId: "r1", conventionIds: ["a"] }));
    expect(await screen.findByText(/modal open · 1 accepted/)).toBeInTheDocument();
  });

  it("links evidence to the exact GitHub line", () => {
    candidates = [candidate("a", "pending")];
    renderPage();
    expect(screen.getByRole("link", { name: /src\/api\/users\.ts:3/ })).toHaveAttribute("href", "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L3");
  });
});
