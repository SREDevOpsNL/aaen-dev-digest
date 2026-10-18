import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionSkillDraft } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ApiError } from "../../../../../../lib/api";
import { ToastProvider } from "../../../../../../lib/toast";

const push = vi.fn();
const createSkill = vi.fn();
let createState: { isPending: boolean; error: unknown } = { isPending: false, error: null };
let agents: Array<{ id: string; name: string }> = [];
let skills: Array<{ id: string; name: string }> = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../../../../../../lib/hooks", () => ({
  useAgents: () => ({ data: agents, isLoading: false }),
  useSkills: () => ({ data: skills }),
  useCreateSkill: () => ({ mutateAsync: createSkill, reset: vi.fn(), ...createState }),
}));

import { CreateSkillModal } from "./CreateSkillModal";

const draft: ConventionSkillDraft = {
  name: "repo-conventions",
  description: "1 house convention extracted from acme/payments-api",
  type: "convention",
  body: "# repo-conventions\n\n## throw-notfounderror\nThrow NotFoundError.",
  evidence_files: ["src/api/users.ts"],
  convention_ids: ["c1"],
};

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ToastProvider>
        <CreateSkillModal repoName="acme/payments-api" acceptedCount={1} draft={draft} onClose={vi.fn()} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

const dialog = () => screen.getByRole("dialog");
const submit = () => within(dialog()).getByRole("button", { name: "Create skill" });
const agentSelect = () => within(dialog()).getByRole("combobox", { name: "Link to agent" });

beforeEach(() => {
  agents = [{ id: "ag1", name: "API Contract Reviewer" }, { id: "ag2", name: "Test Quality Reviewer" }];
  skills = [];
  createState = { isPending: false, error: null };
  createSkill.mockReset().mockResolvedValue({ id: "new-skill" });
  push.mockReset();
});
afterEach(cleanup);

describe("Conventions CreateSkillModal", () => {
  it("prefills the literal repo-conventions name and requires an agent before creating", () => {
    renderModal();
    expect(within(dialog()).getByDisplayValue("repo-conventions")).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.change(agentSelect(), { target: { value: "ag1" } });
    expect(submit()).toBeEnabled();
  });

  it("creates and links the skill in one request", async () => {
    renderModal();
    fireEvent.change(agentSelect(), { target: { value: "ag1" } });
    fireEvent.click(submit());
    await waitFor(() =>
      expect(createSkill).toHaveBeenCalledWith(
        expect.objectContaining({ name: "repo-conventions", source: "extracted", enabled: false, link_agent_id: "ag1", evidence_files: ["src/api/users.ts"] }),
      ),
    );
    expect(createSkill).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/skills/new-skill?tab=config");
  });

  it("points out an existing skill with the same name without renaming or blocking", () => {
    skills = [{ id: "old", name: "repo-conventions" }];
    renderModal();
    const notice = within(dialog()).getByRole("status");
    expect(notice).toHaveTextContent("A skill named “repo-conventions” already exists");
    expect(within(notice).getByRole("link", { name: "open it" })).toHaveAttribute("href", "/skills/old?tab=config");
    expect(within(dialog()).getByDisplayValue("repo-conventions")).toBeInTheDocument();
    fireEvent.change(agentSelect(), { target: { value: "ag1" } });
    expect(submit()).toBeEnabled();
  });

  it("explains how to proceed when there is no agent", () => {
    agents = [];
    renderModal();
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("There is no agent to link the skill to yet.");
    expect(within(dialog()).getByRole("link", { name: "Create an agent" })).toHaveAttribute("href", "/agents");
    expect(submit()).toBeDisabled();
  });

  it("shows the server's 4-skill limit inline", () => {
    createState = { isPending: false, error: new ApiError("limit", 422, "skill_limit_reached", { max: 4 }) };
    renderModal();
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("That agent already has the maximum of 4 skills.");
  });
});
