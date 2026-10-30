import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillSummary } from "@devdigest/shared";
import messages from "../../../messages/en/skills.json";

const push = vi.fn();
const updateSkill = vi.fn();
const deleteSkill = vi.fn();
const createSkill = vi.fn();
let skills: SkillSummary[] = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: skills, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateSkill, isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: deleteSkill, isPending: false, isError: false }),
  useSkillAgents: () => ({ data: [{ id: "a1", name: "Test Quality Reviewer" }], isSuccess: true, isError: false, refetch: vi.fn() }),
  useCreateSkill: () => ({ mutateAsync: createSkill, isPending: false, isError: false }),
}));

import SkillsPage from "./page";
import { approvalFixture } from "@/test/skill-approval";

const skill = (id: string, overrides: Partial<SkillSummary> = {}): SkillSummary => ({
  id,
  name: `skill-${id}`,
  description: `Description of ${id}`,
  type: "rubric",
  source: "manual",
  body: `# Heading ${id}\n\nSome **bold** guidance.`,
  enabled: true,
  version: 3,
  evidence_files: null,
  agent_count: 2, used_by_count: 2,
  approval: approvalFixture(),
  ...overrides,
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsPage />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  skills = [skill("a"), skill("b", { enabled: false, agent_count: 0, used_by_count: 0, version: 1 })];
  push.mockReset();
  updateSkill.mockReset();
  deleteSkill.mockReset().mockResolvedValue({ ok: true });
  createSkill.mockReset().mockResolvedValue({ id: "new" });
});
afterEach(cleanup);

describe("Skills page", () => {
  it("shows one card per skill with name, type, description, toggle, version and agent count", () => {
    renderPage();
    const cards = within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    const first = within(cards[0]!);
    expect(first.getByText("skill-a")).toBeInTheDocument();
    expect(first.getByText("rubric")).toBeInTheDocument();
    expect(first.getByText("Description of a")).toBeInTheDocument();
    expect(first.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(first.getByText("v3")).toBeInTheDocument();
    expect(first.getByText("2 agents")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("No agents")).toBeInTheDocument();
  });

  it("reads the linked-agent count from agent_count", () => {
    skills = [skill("a", { agent_count: 5, used_by_count: 1 })];
    renderPage();
    const card = within(within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem")[0]!);
    expect(card.getByText("5 agents")).toBeInTheDocument();
    expect(card.queryByText("1 agent")).not.toBeInTheDocument();
  });

  it("marks imported skills with an Imported badge on the card and in the preview", () => {
    skills = [skill("a", { source: "imported_file" }), skill("b")];
    renderPage();
    const [imported, manual] = screen.getAllByRole("listitem");
    expect(within(imported!).getByText("Imported")).toBeInTheDocument();
    expect(within(manual!).queryByText("Imported")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview skill skill-a" }));
    expect(within(screen.getByRole("dialog")).getByText("Imported")).toBeInTheDocument();
  });

  it("opens a side preview with the rendered body, and Open details goes to /skills/:id", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Preview skill skill-a" }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByRole("heading", { name: "Heading a" })).toBeInTheDocument(); // Markdown rendered, not raw
    expect(within(drawer).getByText("bold").tagName).toBe("STRONG");
    expect(push).not.toHaveBeenCalled(); // the preview is not a page change
    fireEvent.click(within(drawer).getByRole("button", { name: "Open details" }));
    expect(push).toHaveBeenCalledWith("/skills/a?tab=config");
  });

  it("toggles a skill in place without opening the preview", () => {
    renderPage();
    const card = screen.getAllByRole("listitem")[0]!;
    fireEvent.click(within(card).getByRole("switch"));
    expect(updateSkill).toHaveBeenCalledWith({ id: "a", patch: { enabled: false } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Delete on a card asks for confirmation; Cancel and X keep the skill, Confirm deletes it", async () => {
    renderPage();
    const card = () => screen.getAllByRole("listitem")[0]!;

    fireEvent.click(within(card()).getByRole("button", { name: "Delete skill skill-a" }));
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete skill “skill-a”?");
    expect(dialog).toHaveTextContent("Currently linked to: Test Quality Reviewer");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(card()).getByRole("button", { name: "Delete skill skill-a" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteSkill).not.toHaveBeenCalled();

    fireEvent.click(within(card()).getByRole("button", { name: "Delete skill skill-a" }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteSkill).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Add skill offers Create and Import; Create sends the edited Markdown body", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(screen.getByRole("button", { name: /Import skill/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Create skill/ }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("test-quality-review"), { target: { value: "api-guard" } });
    const body = within(dialog).getByRole("textbox", { name: "Skill body (Markdown)" }) as HTMLTextAreaElement;
    expect(body.value).toContain("# api-guard"); // starter follows the name until edited
    fireEvent.change(body, { target: { value: "# api-guard\n\nFlag removed routes." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create skill" }));

    await waitFor(() =>
      expect(createSkill).toHaveBeenCalledWith(expect.objectContaining({ name: "api-guard", body: "# api-guard\n\nFlag removed routes." })),
    );
    expect(push).toHaveBeenCalledWith("/skills/new?tab=config");
  });

  it("Create stays disabled while the body is empty", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    fireEvent.click(screen.getByRole("button", { name: /Create skill/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("test-quality-review"), { target: { value: "x" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Skill body (Markdown)" }), { target: { value: "   " } });
    expect(within(dialog).getByRole("button", { name: "Create skill" })).toBeDisabled();
  });

  it("the card has no role or tabindex and never nests one control inside another", () => {
    renderPage();
    const card = screen.getAllByRole("listitem")[0]!.querySelector("article")!;
    expect(card).not.toHaveAttribute("role");
    expect(card).not.toHaveAttribute("tabindex");
    expect(card.querySelectorAll("button button, button [role=switch], [role=button] button")).toHaveLength(0);
    const controls = Array.from(card.querySelectorAll("button")); // DOM order = Tab order
    expect(controls.map((el) => el.getAttribute("aria-label") ?? el.getAttribute("role"))).toEqual([
      "Preview skill skill-a",
      "switch",
      "Delete skill skill-a",
    ]);
  });

  it("keyboard: Tab reaches preview, toggle and Delete in order; each key acts only on its own control", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = within(screen.getAllByRole("listitem")[0]!);

    card.getByRole("button", { name: "Preview skill skill-a" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toHaveTextContent("Open details");
    await user.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: "Close" })[0]!);

    card.getByRole("button", { name: "Preview skill skill-a" }).focus();
    await user.tab();
    expect(card.getByRole("switch")).toHaveFocus();
    await user.keyboard(" ");
    expect(updateSkill).toHaveBeenCalledWith({ id: "a", patch: { enabled: false } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // toggling never opens the preview

    await user.tab();
    expect(card.getByRole("button", { name: "Delete skill skill-a" })).toHaveFocus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete skill “skill-a”?");
    expect(dialog).not.toHaveTextContent("Open details"); // the delete key path does not open the preview
  });

  it("clicking the card footer or other non-control surface opens the preview", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = within(screen.getAllByRole("listitem")[0]!);

    for (const text of ["v3", "2 agents", "rubric"]) {
      await user.click(card.getByText(text));
      const drawer = screen.getByRole("dialog");
      expect(drawer).toHaveTextContent("Open details");
      await user.click(within(drawer).getAllByRole("button", { name: "Close" })[0]!);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
    expect(updateSkill).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("pointer clicks on Toggle and Delete keep their own behaviour and never open the preview", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = within(screen.getAllByRole("listitem")[0]!);

    await user.click(card.getByRole("switch"));
    expect(updateSkill).toHaveBeenCalledWith({ id: "a", patch: { enabled: false } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(card.getByRole("button", { name: "Delete skill skill-a" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete skill “skill-a”?");
    expect(dialog).not.toHaveTextContent("Open details");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
