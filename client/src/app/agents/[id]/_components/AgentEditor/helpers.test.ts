import { describe, expect, it } from "vitest";
import { moveLinkedSkill } from "./helpers";

describe("moveLinkedSkill", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves a skill down to the target's position", () => {
    expect(moveLinkedSkill(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a skill up to the target's position", () => {
    expect(moveLinkedSkill(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the same array for a drop on itself or on an unlinked skill", () => {
    expect(moveLinkedSkill(ids, "b", "b")).toBe(ids);
    expect(moveLinkedSkill(ids, "b", "zz")).toBe(ids);
    expect(moveLinkedSkill(ids, "zz", "b")).toBe(ids);
  });
});
