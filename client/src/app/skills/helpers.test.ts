import { describe, expect, it } from "vitest";
import type { SkillSummary } from "@devdigest/shared";
import {
  approximateTokens,
  deriveSkillName,
  filterSkills,
  isSupportedSkillFileName,
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
    used_by_count: 1,
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
    used_by_count: 0,
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
