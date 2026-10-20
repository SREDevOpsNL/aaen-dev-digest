import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/prReview.json";
import { FindingsPreview } from "./FindingsPreview";
import type { PreviewFinding } from "./constants";

afterEach(cleanup);

const CRITICAL: PreviewFinding = {
  severity: "CRITICAL",
  title: "Unauthenticated endpoint",
  category: "security",
  file: "src/router.ts",
  start_line: 19,
  end_line: 55,
  confidence: 0.95,
  rationale: "Every   procedure is\npublic. " + "y".repeat(300),
};
const WARNING: PreviewFinding = {
  severity: "WARNING",
  title: "Inclusive date range",
  category: "bug",
  file: "src/repo.ts",
  start_line: 57,
  end_line: 57,
  confidence: 0.85,
  rationale: "Upper bound is inclusive.",
};

function renderPreview(props: ComponentProps<typeof FindingsPreview>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsPreview {...props} />
    </NextIntlClientProvider>,
  );
}

/** The open card's findings list — the element that scrolls when it overflows. */
function findingsList() {
  return screen.getByRole("tooltip").lastElementChild as HTMLElement;
}

describe("FindingsPreview", () => {
  it("shows non-zero severity counts in severity order", () => {
    renderPreview({ counts: { WARNING: 4, CRITICAL: 1, SUGGESTION: 0 }, items: [CRITICAL, WARNING] });
    const group = screen.getByRole("group", { name: "Findings: 1 CRITICAL, 4 WARNING" });
    expect(group).toHaveTextContent(/^14$/);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("previews every finding read-only on hover and on keyboard focus", () => {
    renderPreview({ counts: { CRITICAL: 1, WARNING: 1 }, items: [CRITICAL, WARNING] });
    const group = screen.getByRole("group");

    fireEvent.mouseEnter(group);
    const tooltip = screen.getByRole("tooltip");
    expect(group).toHaveAttribute("aria-describedby", tooltip.id);
    expect(tooltip).toHaveTextContent("2 FINDINGS IN THIS RUN");
    expect(tooltip).toHaveTextContent("CRITICAL Unauthenticated endpoint · security");
    expect(tooltip).toHaveTextContent("src/router.ts:19-55 · 95%");
    expect(tooltip).toHaveTextContent("src/repo.ts:57 · 85%");
    expect(tooltip).toHaveTextContent("Every procedure is public. " + "y".repeat(152) + "…");
    expect(tooltip.querySelector("button, [title]")).toBeNull();

    fireEvent.mouseLeave(group);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(group);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(group);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes the fixed-position preview when the page scrolls", () => {
    renderPreview({ counts: { WARNING: 1 }, items: [WARNING] });
    fireEvent.mouseEnter(screen.getByRole("group"));
    expect(screen.getByRole("tooltip").parentElement).toHaveStyle({ position: "fixed" });
    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // The studio scrolls inside <main>, not the window.
    const main = document.body.appendChild(document.createElement("main"));
    fireEvent.mouseEnter(screen.getByRole("group"));
    fireEvent.scroll(main);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    main.remove();
  });

  it("stays open while its findings list scrolls by mouse wheel or scrollbar", () => {
    renderPreview({ counts: { CRITICAL: 1, WARNING: 1 }, items: [CRITICAL, WARNING] });
    fireEvent.mouseEnter(screen.getByRole("group"));

    // Both inputs scroll the list itself; its non-bubbling `scroll` event still
    // reaches the capture-phase page-scroll listener.
    fireEvent.wheel(findingsList(), { deltaY: 120 });
    fireEvent.scroll(findingsList(), { target: { scrollTop: 120 } });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseDown(findingsList());
    fireEvent.scroll(findingsList(), { target: { scrollTop: 240 } });
    fireEvent.mouseUp(findingsList());
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(findingsList().scrollTop).toBe(240);
  });

  it("stays open while the pointer moves from the counts into the card, and closes once it leaves both", () => {
    renderPreview({ counts: { CRITICAL: 1, WARNING: 1 }, items: [CRITICAL, WARNING] });
    const group = screen.getByRole("group");
    const count = group.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(group);
    const card = screen.getByRole("tooltip").parentElement as HTMLElement;

    fireEvent.mouseOut(count, { relatedTarget: card });
    fireEvent.mouseOver(card, { relatedTarget: count });
    fireEvent.mouseOut(card, { relatedTarget: findingsList() });
    fireEvent.mouseOver(findingsList(), { relatedTarget: card });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseOut(findingsList(), { relatedTarget: document.body });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("stays open while keyboard focus moves into its scrollable list, and closes once focus leaves", () => {
    renderPreview({ counts: { CRITICAL: 1, WARNING: 1 }, items: [CRITICAL, WARNING] });
    const group = screen.getByRole("group");
    fireEvent.focus(group);

    // Browsers make a scroller without focusable children a tab stop.
    const list = findingsList();
    fireEvent.blur(group, { relatedTarget: list });
    fireEvent.focus(list, { relatedTarget: group });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.scroll(list, { target: { scrollTop: 120 } });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(list, { relatedTarget: group });
    fireEvent.focus(group, { relatedTarget: list });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(group, { relatedTarget: null });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("names the agent and changes the heading only in the latest-agent-runs scope", () => {
    const items = [{ ...CRITICAL, agent_name: "Security Reviewer" }, { ...WARNING, agent_name: null }];
    const { unmount } = renderPreview({ counts: { CRITICAL: 1, WARNING: 1 }, items });
    fireEvent.mouseEnter(screen.getByRole("group"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("2 FINDINGS IN THIS RUN");
    expect(screen.getByRole("tooltip")).not.toHaveTextContent(/Security Reviewer|Unknown agent/);
    unmount();

    renderPreview({ counts: { CRITICAL: 1, WARNING: 1 }, items, scope: "latestAgentRuns" });
    fireEvent.mouseEnter(screen.getByRole("group"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("2 FINDINGS IN LATEST AGENT RUNS");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Unauthenticated endpoint · security · Security Reviewer");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Inclusive date range · bug · Unknown agent");
  });

  it("renders counts without a preview when the findings are not loaded", () => {
    renderPreview({ counts: { WARNING: 2 }, items: [] });
    const group = screen.getByRole("group", { name: "Findings: 2 WARNING" });
    expect(group).not.toHaveAttribute("tabindex");
    fireEvent.mouseEnter(group);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders nothing without findings", () => {
    const { container } = renderPreview({ counts: { CRITICAL: 0 }, items: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
