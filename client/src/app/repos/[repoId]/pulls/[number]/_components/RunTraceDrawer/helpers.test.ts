import { describe, expect, it } from "vitest";
import { formatTokens } from "./helpers";

describe("formatTokens", () => {
  it("formats reported counts", () => {
    expect(formatTokens(12000, 1500)).toBe("12k→1.5k");
  });

  it("shows a dash for a count the run did not report, never a zero", () => {
    expect(formatTokens(null, null)).toBe("—→—");
    expect(formatTokens(1142, null)).toBe("1k→—");
  });
});
