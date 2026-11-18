/**
 * Money is stored as an integer number of poisha (1/100 taka).
 * Parsing and formatting are the only places the decimal point exists.
 */

export function parseTaka(input: string): number | null {
  const cleaned = input.replace(/[,\s৳]/g, "").trim();
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  const minor = Math.round(parseFloat(cleaned) * 100);
  return Number.isFinite(minor) && minor > 0 ? minor : null;
}

export function formatTaka(minor: number, opts: { decimals?: boolean } = {}): string {
  const major = Math.abs(minor) / 100;
  return major.toLocaleString("en-US", {
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : 0,
  });
}

/**
 * Short form for axis labels, where a full figure would not fit.
 * Lakh and crore rather than M and B — this is a taka ledger.
 */
export function formatTakaCompact(minor: number): string {
  const major = Math.abs(minor) / 100;
  if (major >= 10_000_000) return `${+(major / 10_000_000).toFixed(1)}cr`;
  if (major >= 100_000) return `${+(major / 100_000).toFixed(1)}L`;
  if (major >= 1_000) return `${+(major / 1_000).toFixed(major < 10_000 ? 1 : 0)}k`;
  return String(Math.round(major));
}

/**
 * Parses an amount an assistant might pass: a plain number, or a sum written
 * as a string like "10+80+30" (useful when sweeping several jottings into one
 * entry). Digits, a single dot with at most two decimals, and `+` only.
 *
 * Never eval. The regex is the whole parser: anything it does not match is
 * rejected rather than coerced, because a silently mis-read amount is a
 * corrupted ledger and there is no way to notice later.
 *
 * Each term is converted to poisha before summing, so the addition happens in
 * integers and 0.1 + 0.2 never appears.
 */
export function parseAmountExpression(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) return null;
    return Math.round(input * 100);
  }

  const cleaned = input.replace(/[\s,\u09F3]/g, "");
  if (!/^\d+(\.\d{1,2})?(\+\d+(\.\d{1,2})?)*$/.test(cleaned)) return null;

  let minor = 0;
  for (const term of cleaned.split("+")) {
    minor += Math.round(parseFloat(term) * 100);
  }
  return minor > 0 ? minor : null;
}

/**
 * Poisha to taka as a number, for JSON handed to a model. `formatTaka` is for
 * display and returns a grouped string; this returns a value you can compare.
 */
export function toTaka(minor: number): number {
  return minor / 100;
}
