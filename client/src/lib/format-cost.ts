/** Format an authoritative USD run cost without turning missing data into zero. */
export function formatUsdCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "$0.0";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumSignificantDigits: 6,
  }).format(value);
}
