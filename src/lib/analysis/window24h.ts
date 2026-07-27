// Mandatory full 24-hour token scan.
//
// Before any signal is produced we now reconstruct the ENTIRE trailing 24 hours
// bar by bar. Previously the engine looked at whatever candle window happened
// to be cached, so a token could be judged on 20 minutes of tape — which is the
// real reason signals arrived at irregular intervals and disagreed with the
// chart a human was looking at.
//
// The 24h window gives us the things a single snapshot cannot:
//   • where the current price sits inside the day's true range
//   • whether volume is expanding or dying
//   • whether buyers or sellers won each half of the session
//   • the session VWAP, i.e. the average price everyone actually paid
//   • the day's high/low, the two levels every trader is watching
import { getCandles, CANDLE_SPECS } from "../data/candles";
import type { Candle } from "../types";

export interface Window24h {
  /** Candles covering the trailing 24h (5m bars => up to 288). */
  candles: Candle[];
  /** Hours actually covered — a 3-hour-old token can only supply 3. */
  hoursCovered: number;
  complete: boolean;
  high: number;
  low: number;
  open: number;
  close: number;
  changePct: number;
  /** Where price sits in the 24h range: 0 = at the low, 1 = at the high. */
  rangePosition: number;
  vwap: number;
  /** Price vs VWAP as a percentage — above = buyers in profit on the day. */
  vsVwapPct: number;
  volume: number;
  /** Second-half volume / first-half volume. >1 means interest is building. */
  volumeTrend: number;
  /** Share of bars that closed green, 0..1. */
  greenShare: number;
  /** Volume on up bars minus down bars, normalised -1..1. */
  pressure: number;
  /** Largest single-bar move in the session, as a percentage. */
  maxBarMovePct: number;
  /** True when the day's range is unusually tight — coiling before expansion. */
  compressed: boolean;
  notes: string[];
}

/**
 * Fetch the trailing 24 hours at 5-minute resolution.
 *
 * 5m is the right granularity: 288 bars is enough for every indicator and
 * pattern detector to be statistically valid, while still resolving the intraday
 * swings that matter on a memecoin. For very young tokens we fall back to 1m so
 * a 90-minute-old token still yields 90 usable bars instead of 18.
 */
export async function fetch24hCandles(pairAddress: string): Promise<Candle[]> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  let candles: Candle[] = [];
  try {
    candles = await getCandles(pairAddress, CANDLE_SPECS.m5, 5, 288);
  } catch {
    candles = [];
  }

  // Too few 5m bars means the token is younger than ~4 hours; 1m resolves it.
  if (candles.length < 48) {
    try {
      const fine = await getCandles(pairAddress, CANDLE_SPECS.m1, 1, 300);
      if (fine.length > candles.length) candles = fine;
    } catch {
      // keep whatever we already have
    }
  }

  return candles.filter((c) => c.time >= cutoff);
}

/** Analyse a 24h candle set into the session summary used by the scorer. */
export function summarise24h(candles: Candle[]): Window24h | null {
  if (candles.length < 6) return null;

  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  const open = candles[0].open;
  const close = candles[candles.length - 1].close;
  const span = candles[candles.length - 1].time - candles[0].time;
  const hoursCovered = span / 3_600_000;

  const volume = candles.reduce((s, c) => s + (c.volume || 0), 0);

  // VWAP over the session using each bar's typical price.
  let pv = 0;
  let vv = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    const v = c.volume || 0;
    pv += typical * v;
    vv += v;
  }
  const vwap = vv > 0 ? pv / vv : (high + low + close) / 3;

  const half = Math.floor(candles.length / 2);
  const firstVol = candles.slice(0, half).reduce((s, c) => s + (c.volume || 0), 0);
  const secondVol = candles.slice(half).reduce((s, c) => s + (c.volume || 0), 0);
  const volumeTrend = firstVol > 0 ? secondVol / firstVol : 1;

  let green = 0;
  let upVol = 0;
  let downVol = 0;
  let maxBarMovePct = 0;
  for (const c of candles) {
    const v = c.volume || 0;
    if (c.close > c.open) {
      green++;
      upVol += v;
    } else if (c.close < c.open) {
      downVol += v;
    }
    if (c.open > 0) {
      const move = Math.abs(c.close - c.open) / c.open;
      if (move > maxBarMovePct) maxBarMovePct = move;
    }
  }
  const totalDirVol = upVol + downVol;
  const pressure = totalDirVol > 0 ? (upVol - downVol) / totalDirVol : 0;

  const rangeSize = high - low;
  const rangePosition = rangeSize > 0 ? (close - low) / rangeSize : 0.5;
  const rangePct = low > 0 ? rangeSize / low : 0;
  const compressed = rangePct < 0.08 && candles.length >= 48;

  const notes: string[] = [];
  if (hoursCovered < 23) {
    notes.push(
      "Only " + hoursCovered.toFixed(1) +
        "h of history exists — the token is younger than a full session.",
    );
  }
  if (rangePosition > 0.85) {
    notes.push("Price is in the top 15% of the 24h range — chasing here has poor risk/reward.");
  } else if (rangePosition < 0.15) {
    notes.push("Price is in the bottom 15% of the 24h range — near session support.");
  }
  if (volumeTrend > 1.5) {
    notes.push("Volume in the last 12h is " + volumeTrend.toFixed(1) + "x the prior 12h — interest is accelerating.");
  } else if (volumeTrend < 0.5) {
    notes.push("Volume has fallen to " + (volumeTrend * 100).toFixed(0) + "% of the prior 12h — the move is losing fuel.");
  }
  if (compressed) {
    notes.push("The 24h range is unusually tight — a volatility expansion is likely.");
  }
  if (Math.abs(pressure) > 0.3) {
    notes.push(
      (pressure > 0 ? "Buy" : "Sell") + "-side volume dominated the session (" +
        Math.abs(pressure * 100).toFixed(0) + "% imbalance).",
    );
  }

  return {
    candles,
    hoursCovered,
    complete: hoursCovered >= 23,
    high,
    low,
    open,
    close,
    changePct: open > 0 ? ((close - open) / open) * 100 : 0,
    rangePosition,
    vwap,
    vsVwapPct: vwap > 0 ? ((close - vwap) / vwap) * 100 : 0,
    volume,
    volumeTrend,
    greenShare: green / candles.length,
    pressure,
    maxBarMovePct: maxBarMovePct * 100,
    compressed,
    notes,
  };
}

/** Convenience: fetch + summarise in one call. */
export async function scan24h(pairAddress: string): Promise<Window24h | null> {
  const candles = await fetch24hCandles(pairAddress);
  return summarise24h(candles);
}

/**
 * Turn the session into a directional vote in -1..1 plus the score weight it
 * deserves. Deliberately contrarian at the extremes of the range: buying the
 * top of a 24h range on exhausted volume is how signal engines lose money.
 */
export function sessionBias(w: Window24h): {
  vote: number;
  weight: number;
  detail: string;
} {
  let vote = 0;
  const reasons: string[] = [];

  // Volume-weighted order flow is the single most reliable component.
  vote += w.pressure * 0.45;
  if (Math.abs(w.pressure) > 0.15) {
    reasons.push((w.pressure > 0 ? "buyer" : "seller") + "-dominated flow");
  }

  // Trading above VWAP with rising volume is genuine strength.
  if (w.vsVwapPct > 0 && w.volumeTrend > 1) {
    vote += 0.25;
    reasons.push("holding above session VWAP on rising volume");
  } else if (w.vsVwapPct < 0 && w.volumeTrend > 1) {
    vote -= 0.25;
    reasons.push("below session VWAP on rising volume");
  }

  // Position in range: fade the extremes.
  if (w.rangePosition > 0.9) {
    vote -= 0.2;
    reasons.push("pinned at the 24h high with no room above");
  } else if (w.rangePosition < 0.1) {
    vote += 0.1;
    reasons.push("sitting on 24h support");
  } else if (w.rangePosition > 0.55 && w.rangePosition < 0.8 && w.pressure > 0) {
    vote += 0.15;
    reasons.push("upper-half of the range with buyers in control");
  }

  // Dying volume invalidates whatever direction the price implies.
  if (w.volumeTrend < 0.4) {
    vote *= 0.6;
    reasons.push("volume has dried up, so the reading is discounted");
  }

  // An incomplete session is less trustworthy, full stop.
  const coverage = Math.min(1, w.hoursCovered / 24);
  const weight = 16 * Math.max(0.35, coverage);

  return {
    vote: Math.max(-1, Math.min(1, vote)),
    weight,
    detail:
      "24h session (" + w.hoursCovered.toFixed(1) + "h, " + w.candles.length + " bars): " +
      (reasons.length ? reasons.join(", ") : "no decisive session bias") + ".",
  };
}
