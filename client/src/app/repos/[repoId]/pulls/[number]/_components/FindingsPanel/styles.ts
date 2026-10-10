import type { CSSProperties } from "react";

/** Co-located styles for FindingsPanel (extracted from inline styles). */
export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  divider: {
    width: 1,
    height: 18,
    background: "var(--border)",
    margin: "0 2px",
  } satisfies CSSProperties,
  severityFilters: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  severityButton: (color: string, background: string, active: boolean) =>
    ({
      appearance: "none",
      border: "1px solid transparent",
      borderRadius: 5,
      padding: "3px 7px",
      background: active ? background : "transparent",
      boxShadow: active ? `inset 0 0 0 1px ${color}` : "none",
      color,
      cursor: "pointer",
      font: "inherit",
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: "0.03em",
      lineHeight: 1.4,
      whiteSpace: "nowrap",
    }) satisfies CSSProperties,
  separator: {
    color: "var(--text-muted)",
    fontSize: 12,
    userSelect: "none",
  } satisfies CSSProperties,
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
