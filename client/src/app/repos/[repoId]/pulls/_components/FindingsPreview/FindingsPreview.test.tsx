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
