import { describe, expect, it } from "vitest";
import { TOOLTIP_GAP, TOOLTIP_WIDTH, tooltipPosition } from "./helpers";

const viewport = { width: 1400, height: 900 };

describe("tooltipPosition", () => {
  it("opens below the counts, left-aligned, bridging the gap with padding", () => {
    expect(tooltipPosition({ top: 100, bottom: 120, left: 300, right: 360 }, "left", viewport)).toEqual({
      left: 300,
      top: 120,
      paddingTop: TOOLTIP_GAP,
    });
  });

  it("right-aligns to the counts' right edge", () => {
    const position = tooltipPosition({ top: 100, bottom: 120, left: 1100, right: 1160 }, "right", viewport);
    expect(position.left).toBe(1160 - TOOLTIP_WIDTH);
  });

  it("opens above when there is more room above than below", () => {
    expect(tooltipPosition({ top: 800, bottom: 820, left: 300, right: 360 }, "left", viewport)).toEqual({
      left: 300,
      bottom: 100,
      paddingBottom: TOOLTIP_GAP,
    });
  });

  it("stays inside the viewport horizontally", () => {
    expect(tooltipPosition({ top: 100, bottom: 120, left: 1300, right: 1360 }, "left", viewport).left).toBe(
      viewport.width - TOOLTIP_WIDTH - 8,
    );
    expect(tooltipPosition({ top: 100, bottom: 120, left: 0, right: 40 }, "right", viewport).left).toBe(8);
  });
});
