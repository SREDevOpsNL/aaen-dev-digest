import { describe, expect, it } from "vitest";
import { COLUMN_KEYS, GRID } from "./constants";

describe("PR list columns", () => {
  it("keeps the Cost header and grid track aligned between Score and Status", () => {
    expect(COLUMN_KEYS).toEqual([
      "pullRequest",
      "author",
      "size",
      "score",
      "cost",
      "status",
      "updated",
    ]);
    expect(GRID.trim().split(/\s+/)).toHaveLength(COLUMN_KEYS.length);
  });
});
