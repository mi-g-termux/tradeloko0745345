// Client-safe formatting helpers.

/** Subscript digits used for DexScreener-style tiny prices ($0.0₂4567). */
const SUBSCRIPT = ["\u2080", "\u2081", "\u2082", "\u2083", "\u2084", "\u2085", "\u2086", "\u2087", "\u2088", "\u2089"];

function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)] ?? d)
    .join("");
}

/**
 * Price formatter that matches how DEX aggregators show memecoin prices.
 * Very small numbers collapse their leading zeros into a subscript count:
 *   0.00000249  ->  $0.0₅249
 */
export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  const abs = Math.abs(n);

  if (abs >= 1)
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (abs >= 0.01) return `$${n.toFixed(4)}`;

  // Count leading zeros after the decimal point.
  const exp = Math.floor(Math.log10(abs));
  const zeros = Math.abs(exp) - 1;
  if (zeros < 3) return `$${n.toFixed(Math.min(8, zeros + 4))}`;

  const digits = abs
    .toFixed(zeros + 5)
    .slice(2 + zeros)
    .replace(/0+$/, "")
    .slice(0, 4);
  return `$0.0${toSubscript(zeros)}${digits || "0"}`;
}

/** Plain full-precision price for tooltips / detail rows. */
export function usdExact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1)
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
  return `$${n.toFixed(12).replace(/0+$/, "")}`;
}

export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** Compact number prefixed with $ — used for MCap / Liquidity / Volume cells. */
export function compactUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${compact(n)}`;
}

/** Integer with thousands separators (txns / traders). */
export function count(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n > 0 ? "+" : "";
  // Big memecoin moves read better without decimals.
  if (Math.abs(n) >= 100) return `${s}${Math.round(n).toLocaleString()}%`;
  return `${s}${n.toFixed(1)}%`;
}

export function pctColor(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "text-mute";
  if (n === 0) return "text-mute";
  return n > 0 ? "text-up" : "text-down";
}

export function ageLabel(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  if (hours < 1 / 60) return "now";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  if (hours < 24 * 30) return `${Math.round(hours / 24)}d`;
  if (hours < 24 * 365) return `${Math.round(hours / (24 * 30))}mo`;
  return `${(hours / (24 * 365)).toFixed(1)}y`;
}

/** "3m ago" style label from an ISO timestamp. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  if (ms < 0) return "just now";
  const mins = ms / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}
