import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillApprovalRecord, SkillSummary } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ApiError } from "@/lib/api";
import { approvalFixture } from "@/test/skill-approval";

const approve = vi.fn();
const revoke = vi.fn();
const updateSkill = vi.fn();
let approveState: { isPending: boolean; error: unknown } = { isPending: false, error: null };
let history: SkillApprovalRecord[] = [];

vi.mock("@/lib/hooks/skills", () => ({
  useApproveSkill: () => ({ mutate: approve, reset: vi.fn(), ...approveState }),
  useRevokeSkill: () => ({ mutate: revoke, reset: vi.fn(), isPending: false, error: null }),
  useSkillApprovals: () => ({ data: history, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateSkill, isPending: false }),
}));

import { ApprovalPanel } from "./ApprovalPanel";
import { SkillCard } from "../../SkillCard";

const DIGEST = "b".repeat(64);
const skill = (status: Parameters<typeof approvalFixture>[0], enabled = true): Skill => ({
  id: "s1",
  name: "breaking-change",
  description: "",
  type: "rubric",
  source: "manual",
  body: "Flag removed routes.",
  enabled,
  version: 2,
  evidence_files: null,
  approval: approvalFixture(status, { version: 2, body_sha256: DIGEST }),
});

function renderWith(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  approve.mockReset();
  revoke.mockReset();
  approveState = { isPending: false, error: null };
  history = [];
});
afterEach(cleanup);

describe("Skill approval panel", () => {
  it("approves exactly the shown version and digest after confirmation", () => {
    renderWith(<ApprovalPanel skill={skill("unapproved")} />);
    expect(screen.getByTestId("skill-approval")).toHaveAttribute("data-status", "unapproved");
    expect(screen.getByText(`Current content: v2 · sha256 ${DIGEST}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revoke approval/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Approve this content/ }));
    expect(approve).not.toHaveBeenCalled(); // confirmation first
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Approve v2 for the system prompt?");
    fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: "reviewed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Approve$/ }));
    expect(approve).toHaveBeenCalledWith(
      { id: "s1", version: 2, body_sha256: DIGEST, reason: "reviewed" },
      expect.anything(),
    );
  });

  it("shows the exact raw body, including Markdown-hidden text, in the panel and the confirmation", () => {
    const body = "# Rule\n<!-- hidden -->\nFlag removed routes.\n<div hidden>raw html</div>\n[ref]: https://evil.example\n  indented  ";
    renderWith(<ApprovalPanel skill={{ ...skill("unapproved"), body }} />);
    const panelRaw = screen.getByTestId("approval-raw-body");
    expect(panelRaw.tagName).toBe("PRE");
    expect(panelRaw.textContent).toBe(body); // verbatim, whitespace preserved
    expect(panelRaw).toHaveTextContent("<!-- hidden -->", { normalizeWhitespace: false });

    fireEvent.click(screen.getByRole("button", { name: /Approve this content/ }));
    const dialog = screen.getByRole("dialog");
    const confirmRaw = within(dialog).getByTestId("approval-raw-body");
    expect(confirmRaw.textContent).toBe(body);
    expect(within(dialog).getByLabelText("Exact text of v2 to approve")).toBe(confirmRaw);
    expect(within(dialog).getByTestId("approval-confirm-digest")).toHaveTextContent(`v2 · sha256 ${DIGEST}`);
    fireEvent.click(within(dialog).getByRole("button", { name: /^Approve$/ }));
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ version: 2, body_sha256: DIGEST }), expect.anything());
  });

  it("cancelling the confirmation sends nothing", () => {
    renderWith(<ApprovalPanel skill={skill("stale")} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve this content/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(approve).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains a 409 when the body changed since the page loaded", () => {
    approveState = { isPending: false, error: new ApiError("changed", 409, "conflict") };
    renderWith(<ApprovalPanel skill={skill("unapproved")} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve this content/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent(messages.approval.conflict);
  });

  it("revokes an approved skill after confirmation and lists the audit history", () => {
    history = [
      { id: "2", skill_id: "s1", skill_name: "breaking-change", version: 2, body_sha256: DIGEST, decision: "approve", actor_user_id: "u1", actor_name: "You", reason: "second look", created_at: "2026-10-30T11:00:00.000Z" },
      { id: "1", skill_id: "s1", skill_name: "breaking-change", version: 1, body_sha256: "c".repeat(64), decision: "revoke", actor_user_id: "u1", actor_name: "You", reason: null, created_at: "2026-10-30T10:00:00.000Z" },
    ];
    renderWith(<ApprovalPanel skill={skill("approved")} />);
    expect(screen.queryByRole("button", { name: /Approve this content/ })).not.toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "Approval history" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/^Approved v2 · You · .* — second look$/);
    expect(items[1]).toHaveTextContent(/^Revoked v1 · You/);

    fireEvent.click(screen.getByRole("button", { name: /Revoke approval/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Revoke$/ }));
    expect(revoke).toHaveBeenCalledWith({ id: "s1", reason: undefined }, expect.anything());
  });

  it("the skill card shows approval separately from the enabled toggle", () => {
    const summary: SkillSummary = { ...skill("unapproved", true), agent_count: 1, used_by_count: 1 };
    renderWith(<SkillCard skill={summary} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Not approved")).toBeInTheDocument();
    cleanup();
    renderWith(<SkillCard skill={{ ...summary, enabled: false, approval: approvalFixture("approved") }} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Approved for system prompt")).toBeInTheDocument();
  });
});
