import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../lib/toast";

const { mockSkills, mockLinks } = vi.hoisted(() => ({
  mockSkills: [
    { id: "s1", name: "Behavioral Coverage", description: "Check behavior", type: "rubric", source: "manual", body: "body", enabled: true, version: 1, evidence_files: null, used_by_count: 1 },
    { id: "s2", name: "Isolation", description: "Check isolation", type: "convention", source: "manual", body: "body", enabled: false, version: 1, evidence_files: null, used_by_count: 1 },
  ],
  mockLinks: [
    { agent_id: "ag1", skill_id: "s1", order: 0, enabled: true, skill: { id: "s1" } },
    { agent_id: "ag1", skill_id: "s2", order: 1, enabled: false, skill: { id: "s2" } },
  ],
}));

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));
vi.mock("../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({
    data: mockSkills,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAgentSkills: () => ({
    data: mockLinks,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSetAgentSkills: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("renders ordered reusable skill attachments and global state", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    expect(screen.getByText("2 / 4 attached")).toBeInTheDocument();
    expect(screen.getByText("Behavioral Coverage")).toBeInTheDocument();
    expect(screen.getByText("Isolation")).toBeInTheDocument();
    expect(screen.getByText("disabled globally")).toBeInTheDocument();
  });
});
