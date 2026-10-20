import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../messages/en/agents.json";
import { useDeleteSkill, useSetAgentSkills } from "../../../../lib/hooks/skills";
import { AgentsListView } from "./AgentsListView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Only `fetch` is faked: a tiny in-memory API. The real `api` client and the
// real React Query hooks run, so the count comes from the API payload, never
// from a prop set by the test.
const BASE: Omit<Agent, "id" | "name" | "skill_count"> = {
  description: "",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  system_prompt: "Review.",
  output_schema: null,
  enabled: true,
  version: 1,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
};
let agents: Array<{ id: string; name: string }>;
let links: Record<string, string[]>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { pathname } = new URL(String(input));
  const method = init?.method ?? "GET";
  if (method === "GET" && pathname === "/agents") {
    return json(agents.map((a) => ({ ...BASE, ...a, skill_count: links[a.id]?.length ?? 0 })));
  }
  const setLinks = pathname.match(/^\/agents\/([^/]+)\/skills$/);
  if (method === "POST" && setLinks) {
    const agentId = setLinks[1]!;
    links[agentId] = (JSON.parse(String(init?.body)) as { skill_ids: string[] }).skill_ids;
    return json(links[agentId]!.map((skillId, order) => ({ agent_id: agentId, skill_id: skillId, order })));
  }
  const deleteSkill = pathname.match(/^\/skills\/([^/]+)$/);
  if (method === "DELETE" && deleteSkill) {
    for (const id of Object.keys(links)) links[id] = links[id]!.filter((s) => s !== deleteSkill[1]);
    return json({ ok: true });
  }
  return json({ error: { code: "not_found", message: `${method} ${pathname}` } }, 404);
}

beforeEach(() => {
  agents = [
    { id: "a0", name: "General Reviewer" },
    { id: "a1", name: "Single Skill Reviewer" },
    { id: "a4", name: "Test Quality Reviewer" },
  ];
  links = { a1: ["s1"], a4: ["s1", "s2", "s3", "s4"] };
  vi.stubGlobal("fetch", vi.fn(fakeApi));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Test-only controls driving the real link and delete mutations. */
function LinkControls() {
  const setSkills = useSetAgentSkills();
  const deleteSkill = useDeleteSkill();
  return (
    <>
      <button onClick={() => setSkills.mutate({ agentId: "a1", skillIds: ["s1", "s2"] })}>link s2</button>
      <button onClick={() => setSkills.mutate({ agentId: "a1", skillIds: ["s2"] })}>unlink s1</button>
      <button onClick={() => deleteSkill.mutate("s2")}>delete s2</button>
    </>
  );
}

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <AgentsListView />
        <LinkControls />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** The card is the name's header row's parent (see AgentCard). */
const card = (name: string) => screen.getByText(name).parentElement!.parentElement!;

describe("AgentsListView linked-skill count", () => {
  it("shows each agent's count from GET /agents", async () => {
    renderList();
    await screen.findByText("Test Quality Reviewer");
    expect(within(card("General Reviewer")).getByText("0 skills")).toBeInTheDocument();
    expect(within(card("Single Skill Reviewer")).getByText("1 skill")).toBeInTheDocument();
    expect(within(card("Test Quality Reviewer")).getByText("4 skills")).toBeInTheDocument();
  });

  it("refreshes the count after link, unlink and skill deletion", async () => {
    renderList();
    await screen.findByText("Single Skill Reviewer");
    expect(within(card("Single Skill Reviewer")).getByText("1 skill")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "link s2" }));
    await waitFor(() => expect(within(card("Single Skill Reviewer")).getByText("2 skills")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "unlink s1" }));
    await waitFor(() => expect(within(card("Single Skill Reviewer")).getByText("1 skill")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "delete s2" }));
    await waitFor(() => expect(within(card("Single Skill Reviewer")).getByText("0 skills")).toBeInTheDocument());
    expect(within(card("Test Quality Reviewer")).getByText("3 skills")).toBeInTheDocument();
  });
});
