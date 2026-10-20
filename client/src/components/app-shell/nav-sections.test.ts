import { describe, expect, it } from "vitest";
import { NAV } from "@devdigest/ui";

// nav.ts is vendored, but its data is the one sanctioned edit (AGENTS.md "Do not touch").
describe("sidebar navigation sections", () => {
  it("groups Conventions, Agents and Skills under SKILLS LAB, not WORKSPACE", () => {
    expect(NAV.map((group) => [group.section, group.items.map((item) => item.key)])).toEqual([
      ["WORKSPACE", ["pulls"]],
      ["SKILLS LAB", ["conventions", "agents", "skills"]],
    ]);
  });
});
