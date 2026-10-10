import type { CSSProperties } from "react";

export const TOOLTIP_WIDTH = 360;
/** Tallest the preview gets (heading + the 300px scrolling list + padding). */
export const TOOLTIP_MAX_HEIGHT = 360;
/** Gap between the counts and the card; kept hoverable so the pointer can cross it. */
export const TOOLTIP_GAP = 8;
const VIEWPORT_MARGIN = 8;

type Rect = Pick<DOMRect, "top" | "bottom" | "left" | "right">;

/**
 * Viewport position for the preview. It is `position: fixed` because the PR
 * list clips absolutely positioned children; it opens below the counts unless
 * there is more room above, and stays inside the viewport horizontally.
 */
export function tooltipPosition(
  rect: Rect,
  align: "left" | "right",
  viewport: { width: number; height: number },
): CSSProperties {
  const preferredLeft = align === "left" ? rect.left : rect.right - TOOLTIP_WIDTH;
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - TOOLTIP_WIDTH - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(preferredLeft, VIEWPORT_MARGIN), maxLeft);

  const spaceBelow = viewport.height - rect.bottom;
  const openUp = spaceBelow < TOOLTIP_MAX_HEIGHT && rect.top > spaceBelow;
  return openUp
    ? { left, bottom: viewport.height - rect.top, paddingBottom: TOOLTIP_GAP }
    : { left, top: rect.bottom, paddingTop: TOOLTIP_GAP };
}
