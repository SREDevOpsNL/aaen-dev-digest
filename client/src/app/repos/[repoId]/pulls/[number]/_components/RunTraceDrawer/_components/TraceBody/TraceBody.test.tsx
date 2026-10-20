import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json";
import { TraceBody } from "./TraceBody";

const trace = (assembly: Partial<RunTrace["prompt_assembly"]>): RunTrace => ({
  config: { agent: "API Contract Reviewer", version: "1", provider: "openrouter", model: "m", pr: 482, source: "local" },
  stats: { duration_ms: 1000, tokens_in: 1200, tokens_out: 300, cost_usd: null, findings: 0, grounding: "0/0 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: null, memory: null, specs: null, user: "Review PR #482", ...assembly },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  specs_read: [],
  log: [],
});

function renderBody(t: RunTrace) {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <TraceBody trace={t} findings={[]} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByText("Prompt assembly")); // the section starts collapsed
}

const promptRow = (label: string) => screen.getByText(label).parentElement!;

afterEach(cleanup);

describe("TraceBody prompt assembly", () => {
  it("shows the Skills block with its own token count, and no count on the other blocks", () => {
    renderBody(trace({ skills: "<untrusted source=\"skill-0\">### breaking-change</untrusted>", skills_tokens: 312 }));
    expect(promptRow("Skills (dynamic)")).toHaveTextContent("~312 tokens");
    expect(promptRow("System")).not.toHaveTextContent("tokens");
    expect(promptRow("User / diff (dynamic)")).not.toHaveTextContent("tokens");
    expect(screen.getAllByText(/~\d+ tokens?/)).toHaveLength(1);
  });

  it("shows no Skills block when no skill was sent", () => {
    renderBody(trace({ skills: null, skills_tokens: null }));
    expect(screen.queryByText("Skills (dynamic)")).not.toBeInTheDocument();
  });

  it("shows the Skills block without a count for traces written before the count existed", () => {
    renderBody(trace({ skills: "### legacy" }));
    expect(promptRow("Skills (dynamic)")).not.toHaveTextContent("tokens");
  });
});
