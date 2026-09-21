import { describe, expect, it } from "vitest";
import { formatUsdCost } from "./format-cost";

describe("formatUsdCost", () => {
  it("keeps missing and invalid authoritative cost visibly unknown", () => {
    expect(formatUsdCost(null)).toBe("—");
    expect(formatUsdCost(undefined)).toBe("—");
    expect(formatUsdCost(Number.NaN)).toBe("—");
    expect(formatUsdCost(-0.01)).toBe("—");
  });

  it("distinguishes zero and preserves small fractional USD values", () => {
    expect(formatUsdCost(0)).toBe("$0.0");
    expect(formatUsdCost(0.012)).toBe("$0.012");
    expect(formatUsdCost(0.000123)).toBe("$0.000123");
    expect(formatUsdCost(0.0000012)).toBe("$0.0000012");
    expect(formatUsdCost(0.0000004)).toBe("$0.0000004");
    expect(formatUsdCost(1.234567)).toBe("$1.23457");
  });
});
