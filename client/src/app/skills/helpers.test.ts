import { describe, expect, it } from "vitest";
import type { SkillSummary } from "@devdigest/shared";
import {
  approximateTokens,
  deriveSkillName,
  filterSkills,
  isSupportedSkillFileName,
  LINE_DIFF_MAX_CELLS,
  lineDiff,
} from "./helpers";

const SKILLS: SkillSummary[] = [
  {
    id: "one",
    name: "Behavioral Coverage",
    description: "Review observable behavior",
    type: "rubric",
    source: "manual",
    body: "Check behavior.",
    enabled: true,
    version: 1,
    evidence_files: null,
    agent_count: 1, used_by_count: 1,
  },
  {
    id: "two",
    name: "Isolation",
    description: "Reject shared state",
    type: "convention",
    source: "manual",
    body: "Check isolation.",
    enabled: false,
    version: 2,
    evidence_files: null,
    agent_count: 0, used_by_count: 0,
  },
];

describe("skills helpers", () => {
  it("filters name, description, and type case-insensitively", () => {
    expect(filterSkills(SKILLS, "behavioral")).toEqual([SKILLS[0]]);
    expect(filterSkills(SKILLS, "SHARED STATE")).toEqual([SKILLS[1]]);
    expect(filterSkills(SKILLS, "convention")).toEqual([SKILLS[1]]);
    expect(filterSkills(SKILLS, "  ")).toBe(SKILLS);
  });

  it("derives an editable name from a heading before falling back to filename", () => {
    expect(deriveSkillName("intro\n# Test Quality\nbody", "fallback.md")).toBe("Test Quality");
    expect(deriveSkillName("no heading", "review-rules.markdown")).toBe("review-rules");
    expect(deriveSkillName("no heading")).toBe("");
  });

  it("accepts only the supported local text extensions", () => {
    expect(isSupportedSkillFileName("skill.MD")).toBe(true);
    expect(isSupportedSkillFileName("skill.markdown")).toBe(true);
    expect(isSupportedSkillFileName("skill.txt")).toBe(true);
    expect(isSupportedSkillFileName("skill.zip")).toBe(false);
  });

  it("uses the UI token estimate documented by the editor", () => {
    expect(approximateTokens("")).toBe(0);
    expect(approximateTokens("12345")).toBe(2);
  });
});

describe("lineDiff", () => {
  const render = (before: string, after: string) =>
    lineDiff(before, after).map((line) => `${{ same: " ", add: "+", del: "-" }[line.kind]}${line.text}`);

  it("returns only unchanged lines for identical bodies", () => {
    expect(render("a\nb", "a\nb")).toEqual([" a", " b"]);
  });

  it("marks a changed line as removed then added, keeping the context around it", () => {
    expect(render("# Title\nold rule\nfooter", "# Title\nnew rule\nfooter")).toEqual([
      " # Title",
      "-old rule",
      "+new rule",
      " footer",
    ]);
  });

  it("handles pure insertions and deletions, including at the ends", () => {
    expect(render("a\nc", "a\nb\nc")).toEqual([" a", "+b", " c"]);
    expect(render("a\nb\nc", "b\nc")).toEqual(["-a", " b", " c"]);
    expect(render("a", "a\nz")).toEqual([" a", "+z"]);
  });

  it("finds the longest common subsequence when lines move", () => {
    expect(render("x\na\nb\nc", "a\nb\nx\nc")).toEqual(["-x", " a", " b", "+x", " c"]);
  });

  it("falls back to one removed and one added block when the middle is too large", () => {
    const size = Math.ceil(Math.sqrt(LINE_DIFF_MAX_CELLS)) + 1;
    const before = ["head", ...Array.from({ length: size }, (_, i) => `a${i}`), "tail"].join("\n");
    const after = ["head", ...Array.from({ length: size }, (_, i) => `b${i}`), "tail"].join("\n");
    const lines = lineDiff(before, after);
    expect(lines[0]).toEqual({ kind: "same", text: "head" });
    expect(lines.at(-1)).toEqual({ kind: "same", text: "tail" });
    expect(lines.filter((l) => l.kind === "del")).toHaveLength(size);
    expect(lines.findIndex((l) => l.kind === "add")).toBe(size + 1);
  });
});
