import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, SkillSummary } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../messages/en/skills.json";

const mutate = vi.fn();
const mutateEnabled = vi.fn();
let pending = false;
let linkOff = new Set<string>();

const skill = (id: string, name: string, enabled = true): SkillSummary => ({
  id, name, description: `${name} guidance`, type: "rubric", source: "manual", body: "b", enabled, version: 1, evidence_files: null, agent_count: 1, used_by_count: 1, approval: approvalFixture(),
});
const SKILLS = [skill("s1", "Alpha"), skill("s2", "Beta off", false), skill("s3", "Gamma"), skill("s4", "Delta")];
let skillsData = SKILLS;
const buildLinks = () =>
  ["s1", "s2", "s3"].map((id, order) => ({ agent_id: "ag1", skill_id: id, order, enabled: id !== "s2", link_enabled: !linkOff.has(id), skill: { id } }));
// One stable array per test, as react-query returns: a new array on every
// render would re-run the tab's links effect forever.
let linksData = buildLinks();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: skillsData, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentSkills: () => ({ data: linksData, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate, isPending: pending }),
  useSetAgentSkillEnabled: () => ({ mutate: mutateEnabled, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";
import { approvalFixture } from "@/test/skill-approval";

const AGENT = { id: "ag1", name: "API Contract Reviewer" } as Agent;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillsMessages }}>
      <SkillsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

const row = (id: string) => screen.getByTestId(`agent-skill-${id}`);
const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" });
function dragOnto(fromId: string, toId: string) {
  const dt = dataTransfer();
  fireEvent.dragStart(row(fromId), { dataTransfer: dt });
  fireEvent.dragOver(row(toId), { dataTransfer: dt });
  fireEvent.drop(row(toId), { dataTransfer: dt });
  fireEvent.dragEnd(row(fromId), { dataTransfer: dt });
}

beforeEach(() => {
  mutate.mockReset();
  mutateEnabled.mockReset();
  pending = false;
  linkOff = new Set();
  linksData = buildLinks();
  skillsData = SKILLS;
});
afterEach(cleanup);

describe("Agent Skills tab", () => {
  it("lists every skill with a link toggle and its category label", () => {
    renderTab();
    for (const [id, name, on] of [["s1", "Alpha", true], ["s2", "Beta off", true], ["s3", "Gamma", true], ["s4", "Delta", false]] as const) {
      expect(screen.getByRole("switch", { name: `Attach ${name} to this agent` })).toHaveAttribute("aria-checked", String(on));
      expect(row(id)).toHaveTextContent("rubric");
    }
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("the toggle links and unlinks a skill", () => {
    renderTab();
    fireEvent.click(screen.getByRole("switch", { name: "Attach Delta to this agent" }));
    expect(mutate).toHaveBeenLastCalledWith({ agentId: "ag1", skillIds: ["s1", "s2", "s3", "s4"] }, expect.anything());
    fireEvent.click(screen.getByRole("switch", { name: "Attach Alpha to this agent" }));
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("gives each linked skill a per-agent enabled switch, and unlinked skills none", () => {
    renderTab();
    for (const name of ["Alpha", "Beta off", "Gamma"]) {
      expect(screen.getByRole("switch", { name: `Use ${name} in this agent's reviews` })).toHaveAttribute("aria-checked", "true");
    }
    expect(screen.queryByRole("switch", { name: "Use Delta in this agent's reviews" })).not.toBeInTheDocument();
  });

  it("the per-agent switch updates only that link and never relinks", () => {
    renderTab();
    fireEvent.click(screen.getByRole("switch", { name: "Use Gamma in this agent's reviews" }));
    expect(mutateEnabled).toHaveBeenCalledWith({ agentId: "ag1", skillId: "s3", enabled: false });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("a skill switched off for this agent is marked, not draggable, and takes no drop", () => {
    linkOff = new Set(["s3"]);
    linksData = buildLinks();
    renderTab();
    expect(screen.getByRole("switch", { name: "Use Gamma in this agent's reviews" })).toHaveAttribute("aria-checked", "false");
    expect(row("s3")).toHaveTextContent("Off for this agent");
    expect(row("s3")).toHaveAttribute("draggable", "false");
    expect(row("s1")).toHaveAttribute("draggable", "true");
    dragOnto("s1", "s3");
    dragOnto("s3", "s1");
    expect(mutate).not.toHaveBeenCalled();
    // Switching it back on asks for enabled: true.
    fireEvent.click(screen.getByRole("switch", { name: "Use Gamma in this agent's reviews" }));
    expect(mutateEnabled).toHaveBeenCalledWith({ agentId: "ag1", skillId: "s3", enabled: true });
  });

  it("explains both switches once, above the list, and labels their columns", () => {
    renderTab();
    const legend = screen.getAllByRole("definition")[0]!.closest("dl")!;
    expect(legend).toHaveAccessibleName("What the controls do");
    expect(legend).toHaveTextContent("AttachedLinks the skill to this agent (up to 4). Switching it off detaches the skill from this agent only.");
    expect(legend).toHaveTextContent(/Enabled for this agent.*part of this agent's review prompt/);
    expect(legend).toHaveTextContent(/without detaching it, losing its place in the order, or switching it off for other agents/);
    expect(legend).toHaveTextContent("Off for this agent");
    expect(legend).toHaveTextContent("drag an enabled skill to reorder");
    for (const heading of ["Attached", "Skill", "Enabled for this agent", "Type", "Order"]) {
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
    }
  });

  it("gives every switch an accessible name and a tooltip that says what it does", () => {
    renderTab();
    for (const control of screen.getAllByRole("switch")) expect(control).toHaveAccessibleName();
    const attach = screen.getByRole("switch", { name: "Attach Gamma to this agent" }).closest("label")!;
    expect(attach).toHaveAttribute("title", expect.stringMatching(/^Attached to agent: .*detach it from this agent only/));
    const enabled = screen.getByRole("switch", { name: "Use Gamma in this agent's reviews" }).closest("label")!;
    expect(enabled).toHaveAttribute("title", expect.stringMatching(/^Enabled for this agent: .*stays attached.*stays on for other agents/));
  });

  it("shows the per-agent state in words, and explains the off state where it appears", () => {
    linkOff = new Set(["s3"]);
    linksData = buildLinks();
    renderTab();
    expect(row("s1")).toHaveTextContent("On");
    expect(row("s3")).toHaveTextContent("Off");
    expect(screen.getByText("Off for this agent").closest("[title]")).toHaveAttribute("title", expect.stringMatching(/left out of this agent's review prompt/));
    expect(screen.getByText("Disabled globally").closest("[title]")).toHaveAttribute("title", expect.stringMatching(/no agent uses it/));
    // An unattached skill has no per-agent switch, only a hint to attach it first.
    expect(row("s4").querySelector('[title="Attach the skill first."]')).not.toBeNull();
  });

  it("only linked, globally enabled skills are draggable", () => {
    renderTab();
    expect(row("s1")).toHaveAttribute("draggable", "true");
    expect(row("s3")).toHaveAttribute("draggable", "true");
    expect(row("s2")).toHaveAttribute("draggable", "false"); // linked but disabled globally
    expect(row("s4")).toHaveAttribute("draggable", "false"); // enabled but not linked
  });

  it("dropping an enabled skill on another persists the new order", () => {
    renderTab();
    dragOnto("s3", "s1");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["s3", "s1", "s2"] }, expect.objectContaining({ onError: expect.any(Function) }));
    // Optimistic: the rows are already in the new order.
    const order = screen.getAllByTestId(/^agent-skill-/).map((el) => el.getAttribute("data-testid"));
    expect(order.slice(0, 3)).toEqual(["agent-skill-s3", "agent-skill-s1", "agent-skill-s2"]);
  });

  it("a disabled or unlinked skill can neither be dragged nor take a drop", () => {
    renderTab();
    dragOnto("s2", "s3"); // disabled source
    dragOnto("s4", "s1"); // unlinked source
    dragOnto("s1", "s2"); // disabled target
    dragOnto("s1", "s4"); // unlinked target
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keeps the arrows as the keyboard alternative", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Move Alpha down" }));
    expect(mutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["s2", "s1", "s3"] }, expect.anything());
  });

  it("does not start a drag while a save is pending", () => {
    pending = true;
    renderTab();
    expect(row("s1")).toHaveAttribute("draggable", "false");
    dragOnto("s3", "s1");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows each skill's approval separately from Enabled, and warns when an enabled linked skill blocks reviews", () => {
    // s1 (linked, on) is stale; s2 (linked, globally off) and s4 (not linked) are unapproved; s3 is approved.
    const status = { s1: "stale", s2: "unapproved", s3: "approved", s4: "unapproved" } as const;
    skillsData = SKILLS.map((sk) => ({ ...sk, approval: approvalFixture(status[sk.id as keyof typeof status]) }));
    renderTab();
    expect(within(row("s1")).getByTestId("skill-approval")).toHaveAttribute("data-status", "stale");
    expect(within(row("s1")).getByText("Approval stale")).toBeInTheDocument();
    expect(within(row("s3")).getByText("Approved for system prompt")).toBeInTheDocument();
    // Enabled-for-agent is still on for s1: the two states are independent.
    expect(screen.getByRole("switch", { name: "Use Alpha in this agent's reviews" })).toHaveAttribute("aria-checked", "true");
    const alert = screen.getByTestId("approval-blocked");
    expect(alert).toHaveTextContent("Alpha");
    // A globally disabled or unlinked unapproved skill does not block reviews.
    expect(alert).not.toHaveTextContent("Beta off");
    expect(alert).not.toHaveTextContent("Delta");
  });

  it("does not warn when the unapproved skill is switched off for this agent", () => {
    linkOff = new Set(["s1"]);
    linksData = buildLinks();
    skillsData = SKILLS.map((sk) => ({ ...sk, approval: approvalFixture(sk.id === "s1" ? "revoked" : "approved") }));
    renderTab();
    expect(screen.queryByTestId("approval-blocked")).not.toBeInTheDocument();
    expect(within(row("s1")).getByText("Approval revoked")).toBeInTheDocument();
  });
});
