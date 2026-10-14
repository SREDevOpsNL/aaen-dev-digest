import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  badges: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } satisfies CSSProperties,
  notice: (tone: "warn" | "error" | "info"): CSSProperties => ({
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 13,
    color: tone === "error" ? "var(--crit)" : tone === "warn" ? "var(--warn)" : "var(--text-secondary)",
    background: tone === "error" ? "var(--crit-bg)" : tone === "warn" ? "var(--warn-bg)" : "transparent",
    border: tone === "info" ? "1px solid var(--border)" : "none",
  }),
  heading: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", marginBottom: 6 } satisfies CSSProperties,
  list: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  cite: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
