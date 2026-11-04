import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";

const restore = vi.fn();
const reset = vi.fn();
let restoreState = { isPending: false, isError: false };
let versions: SkillVersion[] = [];

vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: () => ({ data: versions, isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate: restore, reset, ...restoreState }),
}));

import { SkillEditor } from "../SkillEditor";
import { VersionsTab } from "./VersionsTab";
import { approvalFixture } from "@/test/skill-approval";

const skill: Skill = {
  id: "s1",
  name: "breaking-change",
  description: "",
  type: "rubric",
  source: "imported_file",
  body: "# Rule\nFlag removed routes.\nFooter",
  enabled: true,
  version: 3,
  evidence_files: null,
  approval: approvalFixture("approved", { version: 3 }),
};

const version = (n: number, body: string): SkillVersion => ({
  skill_id: "s1",
  version: n,
  body,
  message: null,
  created_at: "2026-10-17T10:00:00.000Z",
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <VersionsTab skill={skill} />
    </NextIntlClientProvider>,
  );
}

const row = (n: number) => screen.getByRole("article", { name: `v${n}` });

beforeEach(() => {
  versions = [
    version(1, "# Rule\nFlag renamed fields.\nFooter"),
    version(2, "# Rule\nFlag removed routes.\nFooter"),
    version(3, skill.body),
  ];
  restoreState = { isPending: false, isError: false };
  restore.mockReset();
  reset.mockReset();
});
afterEach(cleanup);

describe("VersionsTab", () => {
  it("is labelled Versioning in the skill editor tabs", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillEditor skill={skill} tab="versions" onTab={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Versioning" })).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument(); // provenance badge in the header
  });

  it("lists every version; only previous versions offer Diff and Restore", () => {
    renderTab();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(within(row(3)).queryByRole("button", { name: "Diff" })).not.toBeInTheDocument();
    expect(within(row(3)).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    for (const n of [1, 2]) {
      expect(within(row(n)).getByRole("button", { name: "Diff" })).toBeInTheDocument();
      expect(within(row(n)).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    }
  });

  it("Diff shows the line changes from that version to the current body", () => {
    renderTab();
    fireEvent.click(within(row(1)).getByRole("button", { name: "Diff" }));
    expect(within(row(1)).getByText("Changes from v1 to the current v3", { exact: false })).toBeInTheDocument();
    const lines = Array.from(screen.getByTestId("version-diff").children).map((el) => [
      el.getAttribute("data-kind"),
      el.textContent?.trim(),
    ]);
    expect(lines).toEqual([
      ["same", "# Rule"],
      ["del", "− Flag renamed fields."],
      ["add", "+ Flag removed routes."],
      ["same", "Footer"],
    ]);
    fireEvent.click(within(row(1)).getByRole("button", { name: "Hide diff" }));
    expect(screen.queryByTestId("version-diff")).not.toBeInTheDocument();
  });

  it("Diff of a version identical to the current body says so", () => {
    renderTab();
    fireEvent.click(within(row(2)).getByRole("button", { name: "Diff" }));
    expect(within(row(2)).getByText("This version’s body is identical to the current body.")).toBeInTheDocument();
  });

  it("Restore asks for confirmation; Cancel and X do nothing, Confirm restores that version", () => {
    renderTab();
    fireEvent.click(within(row(1)).getByRole("button", { name: "Restore" }));
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Restore v1?");
    expect(dialog).toHaveTextContent("becomes a new version, v4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(row(1)).getByRole("button", { name: "Restore" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(restore).not.toHaveBeenCalled();

    fireEvent.click(within(row(1)).getByRole("button", { name: "Restore" }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    expect(restore).toHaveBeenCalledWith({ id: "s1", version: 1 }, expect.objectContaining({ onSuccess: expect.any(Function) }));
    act(() => restore.mock.calls[0]![1].onSuccess());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a restore failure inside the dialog", () => {
    restoreState = { isPending: false, isError: true };
    renderTab();
    fireEvent.click(within(row(2)).getByRole("button", { name: "Restore" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Could not restore this version.");
  });
});
