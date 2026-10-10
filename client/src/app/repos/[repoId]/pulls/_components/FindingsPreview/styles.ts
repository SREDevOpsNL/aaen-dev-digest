import type { CSSProperties } from "react";
import { TOOLTIP_WIDTH } from "./helpers";

/** Co-located styles for FindingsPreview. */
export const s = {
  trigger: (interactive: boolean) =>
    ({
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      width: "fit-content",
      cursor: interactive ? "help" : "default",
    }) satisfies CSSProperties,
  count: (color: string) =>
    ({
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: 11.5,
      fontWeight: 600,
      color,
      borderBottom: `1px dotted ${color}`,
      paddingBottom: 1,
    }) satisfies CSSProperties,
  /** Transparent, fixed frame; its padding bridges the gap to the counts. */
  tooltipFrame: (position: CSSProperties) =>
    ({
      position: "fixed",
      zIndex: 50,
      width: TOOLTIP_WIDTH,
      ...position,
    }) satisfies CSSProperties,
  tooltipCard: {
    display: "block",
    padding: 12,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,.25)",
    cursor: "default",
    textAlign: "left",
    fontWeight: 400,
  } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 9,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 9,
    maxHeight: 300,
    overflowY: "auto",
  } satisfies CSSProperties,
  item: (last: boolean) =>
    ({
      display: "block",
      paddingBottom: last ? 0 : 9,
      borderBottom: last ? "none" : "1px solid var(--border)",
    }) satisfies CSSProperties,
  itemHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    fontSize: 12.5,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  severity: (color: string) =>
    ({
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      fontSize: 10.5,
      fontWeight: 700,
      letterSpacing: "0.03em",
      color,
    }) satisfies CSSProperties,
  category: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  location: {
    display: "block",
    marginTop: 5,
    fontSize: 11,
    color: "var(--accent-text)",
  } satisfies CSSProperties,
  description: {
    marginTop: 5,
    fontSize: 11.5,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
};
