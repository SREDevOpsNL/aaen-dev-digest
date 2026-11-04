import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/skills.json";

const deleteSkill = vi.fn();
const refetch = vi.fn();
let impact: { data?: { id: string; name: string }[]; isSuccess: boolean; isError: boolean };

vi.mock("@/lib/hooks/skills", () => ({
  useDeleteSkill: () => ({ mutateAsync: deleteSkill, isPending: false, isError: false }),
  useSkillAgents: () => ({ ...impact, refetch }),
}));

import { DeleteSkillModal } from "./DeleteSkillModal";

function renderModal() {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <DeleteSkillModal skill={{ id: "s1", name: "api-guard" }} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

const confirmButton = () => screen.getByRole("button", { name: "Delete" });

beforeEach(() => {
  deleteSkill.mockReset().mockResolvedValue({ ok: true });
  refetch.mockReset();
});
afterEach(cleanup);

describe("DeleteSkillModal — impact must be known before deleting", () => {
  it("while the linked agents load, Confirm is disabled and the check is announced", async () => {
    impact = { data: undefined, isSuccess: false, isError: false };
    renderModal();
    expect(screen.getByRole("status")).toHaveTextContent("Checking which agents use this skill…");
    expect(confirmButton()).toBeDisabled();
    await userEvent.click(confirmButton());
    expect(deleteSkill).not.toHaveBeenCalled();
  });

  it("if the impact query fails, Confirm stays disabled and Retry refetches", async () => {
    impact = { data: undefined, isSuccess: false, isError: true };
    renderModal();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not check which agents use this skill");
    expect(confirmButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(deleteSkill).not.toHaveBeenCalled();
  });

  it("with no linked agents, says so and allows deletion", async () => {
    impact = { data: [], isSuccess: true, isError: false };
    const { onClose } = renderModal();
    expect(screen.getByText("No agent uses this skill.")).toBeInTheDocument();
    await userEvent.click(confirmButton());
    expect(deleteSkill).toHaveBeenCalledWith("s1");
    expect(onClose).toHaveBeenCalled();
  });

  it("with linked agents, names them before Confirm is enabled", () => {
    impact = { data: [{ id: "a1", name: "API Contract Reviewer" }, { id: "a2", name: "General Reviewer" }], isSuccess: true, isError: false };
    renderModal();
    expect(screen.getByText("Currently linked to: API Contract Reviewer, General Reviewer")).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });
});
