import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, SkillSummary } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/agents.json";

const mutate = vi.fn();
let pending = false;

const skill = (id: string, name: string, enabled = true): SkillSummary => ({
  id, name, description: `${name} guidance`, type: "rubric", source: "manual", body: "b", enabled, version: 1, evidence_files: null, agent_count: 1, used_by_count: 1,
});
const SKILLS = [skill("s1", "Alpha"), skill("s2", "Beta off", false), skill("s3", "Gamma"), skill("s4", "Delta")];
const LINKS = ["s1", "s2", "s3"].map((id, order) => ({ agent_id: "ag1", skill_id: id, order, enabled: id !== "s2", skill: { id } }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentSkills: () => ({ data: LINKS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate, isPending: pending }),
}));

import { SkillsTab } from "./SkillsTab";

const AGENT = { id: "ag1", name: "API Contract Reviewer" } as Agent;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
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
  pending = false;
});
afterEach(cleanup);

describe("Agent Skills tab", () => {
  it("lists every skill with a link toggle and its category label", () => {
    renderTab();
    for (const [id, name, on] of [["s1", "Alpha", true], ["s2", "Beta off", true], ["s3", "Gamma", true], ["s4", "Delta", false]] as const) {
      expect(screen.getByRole("switch", { name: `${name} attached to this agent` })).toHaveAttribute("aria-checked", String(on));
      expect(row(id)).toHaveTextContent("rubric");
    }
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("the toggle links and unlinks a skill", () => {
    renderTab();
    fireEvent.click(screen.getByRole("switch", { name: "Delta attached to this agent" }));
    expect(mutate).toHaveBeenLastCalledWith({ agentId: "ag1", skillIds: ["s1", "s2", "s3", "s4"] }, expect.anything());
    fireEvent.click(screen.getByRole("switch", { name: "Alpha attached to this agent" }));
    expect(mutate).toHaveBeenCalledTimes(2);
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
});
