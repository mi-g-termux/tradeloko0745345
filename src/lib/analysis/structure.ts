// Market structure, ZigZag swings, SuperTrend and institutional price-action
// levels — the layer that tells us WHERE we are before we decide WHAT to do.
//
// A pattern without structure is worthless. A bullish engulfing at the top of a
// 24h range against a bearish structure is a trap; the same bar at a defended
// demand zone in a bullish structure is a signal. Everything here exists so the
// scorer can tell those two apart.
import type { Candle } from "../types";

export interface Pivot {
  index: number;
  price: number;
  kind: "high" | "low";
  time: number;
}

/**
 * ZigZag — the swing skeleton of the chart.
 *
 * Walks the series tracking the running extreme and only commits a pivot once
 * price has retraced `depthPct` from it. That percentage threshold is what
 * makes it noise-immune: on a memecoin printing 3% wiggles, a 5% ZigZag ignores
 * them entirely and returns only the swings a human would actually draw.
 *
 * `depthPct` is auto-scaled by the caller from ATR so it adapts to each token.
 */
export function zigzag(candles: Candle[], depthPct = 0.05): Pivot[] {
  const pivots: Pivot[] = [];
  if (candles.length < 5) return pivots;

  let dir: "up" | "down" | null = null;
  let extremeIdx = 0;
  let extreme = candles[0].close;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (dir === null) {
      // Establish the initial leg once price has moved enough either way.
      if (c.high >= extreme * (1 + depthPct)) {
        dir = "up";
        extreme = c.high;
        extremeIdx = i;
      } else if (c.low <= extreme * (1 - depthPct)) {
        dir = "down";
        extreme = c.low;
        extremeIdx = i;
      }
      continue;
    }

    if (dir === "up") {
      if (c.high > extreme) {
        extreme = c.high;
        extremeIdx = i;
      } else if (c.low <= extreme * (1 - depthPct)) {
        // Confirmed reversal: the running high becomes a real swing high.
        pivots.push({
          index: extremeIdx,
          price: extreme,
          kind: "high",
          time: candles[extremeIdx].time,
        });
        dir = "down";
        extreme = c.low;
        extremeIdx = i;
      }
    } else {
      if (c.low < extreme) {
        extreme = c.low;
        extremeIdx = i;
      } else if (c.high >= extreme * (1 + depthPct)) {
        pivots.push({
          index: extremeIdx,
          price: extreme,
          kind: "low",
          time: candles[extremeIdx].time,
        });
        dir = "up";
        extreme = c.high;
        extremeIdx = i;
      }
    }
  }

  // The in-progress leg is a provisional pivot — include it so the most recent
  // structure is visible, since that is the part that matters most.
  if (dir !== null) {
    pivots.push({
      index: extremeIdx,
      price: extreme,
      kind: dir === "up" ? "high" : "low",
      time: candles[extremeIdx].time,
    });
  }
  return pivots;
}

/** Choose a ZigZag depth from realised volatility so it fits the token. */
export function autoDepth(candles: Candle[]): number {
  if (candles.length < 10) return 0.05;
  let sum = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    if (prev > 0) sum += Math.abs(candles[i].close - prev) / prev;
  }
  const avgMove = sum / (candles.length - 1);
  // ~4 average bars of movement defines a swing; clamped to sane bounds.
  return Math.min(0.15, Math.max(0.015, avgMove * 4));
}

export type StructureBias = "bullish" | "bearish" | "range";

export interface MarketStructure {
  bias: StructureBias;
  /** e.g. "HH → HL → HH" — the actual swing sequence. */
  sequence: string;
  /** Break of structure: trend continuation through a prior swing. */
  bos: { direction: "up" | "down"; level: number } | null;
  /** Change of character: the first break AGAINST the prevailing trend. */
  choch: { direction: "up" | "down"; level: number } | null;
  lastHigh: number | null;
  lastLow: number | null;
  detail: string;
}

/**
 * Classify the swing sequence into HH/HL (bullish) or LH/LL (bearish), and
 * detect BOS / CHoCH the way institutional price-action traders mark them.
 */
export function marketStructure(
  candles: Candle[],
  pivots: Pivot[],
): MarketStructure {
  const empty: MarketStructure = {
    bias: "range",
    sequence: "insufficient swings",
    bos: null,
    choch: null,
    lastHigh: null,
    lastLow: null,
    detail: "Not enough completed swings to read structure.",
  };
  if (pivots.length < 4 || candles.length < 10) return empty;

  const highs = pivots.filter((p) => p.kind === "high");
  const lows = pivots.filter((p) => p.kind === "low");
  if (highs.length < 2 || lows.length < 2) return empty;

  const labels: string[] = [];
  for (let i = 1; i < pivots.length; i++) {
    const cur = pivots[i];
    const prevSame = pivots
      .slice(0, i)
      .reverse()
      .find((p) => p.kind === cur.kind);
    if (!prevSame) continue;
    if (cur.kind === "high") labels.push(cur.price > prevSame.price ? "HH" : "LH");
    else labels.push(cur.price > prevSame.price ? "HL" : "LL");
  }

  const recent = labels.slice(-4);
  const bull = recent.filter((l) => l === "HH" || l === "HL").length;
  const bear = recent.filter((l) => l === "LH" || l === "LL").length;
  let bias: StructureBias = "range";
  if (bull >= 3 && bull > bear) bias = "bullish";
  else if (bear >= 3 && bear > bull) bias = "bearish";

  const lastHigh = highs[highs.length - 1]?.price ?? null;
  const lastLow = lows[lows.length - 1]?.price ?? null;
  const price = candles[candles.length - 1].close;

  // A break only counts on a CLOSE beyond the level, not a wick through it —
  // wick-through-then-reject is a liquidity sweep, the opposite of a break.
  const prevHigh = highs.length >= 2 ? highs[highs.length - 2].price : null;
  const prevLow = lows.length >= 2 ? lows[lows.length - 2].price : null;

  let bos: MarketStructure["bos"] = null;
  let choch: MarketStructure["choch"] = null;

  if (prevHigh != null && price > prevHigh) {
    if (bias === "bullish") bos = { direction: "up", level: prevHigh };
    else choch = { direction: "up", level: prevHigh };
  } else if (prevLow != null && price < prevLow) {
    if (bias === "bearish") bos = { direction: "down", level: prevLow };
    else choch = { direction: "down", level: prevLow };
  }

  const sequence = recent.join(" → ") || "flat";
  let detail = "Structure is " + bias + " (" + sequence + ").";
  if (bos) {
    detail +=
      " Break of structure " + bos.direction + " through " +
      bos.level.toPrecision(4) + " — trend continuation.";
  }
  if (choch) {
    detail +=
      " Change of character " + choch.direction + " through " +
      choch.level.toPrecision(4) + " — the trend may be flipping.";
  }

  return { bias, sequence, bos, choch, lastHigh, lastLow, detail };
}

export interface Level {
  price: number;
  kind: "support" | "resistance";
  /** How many separate swings respected this price. More touches = stronger. */
  touches: number;
  /** Distance from current price as a percentage (negative = below). */
  distancePct: number;
}

/**
 * Cluster swing pivots into horizontal levels. Prices within `tolerance` of
 * each other are the same level, and each extra touch strengthens it — that is
 * exactly how a human draws support and resistance.
 */
export function keyLevels(
  pivots: Pivot[],
  price: number,
  tolerance = 0.015,
  max = 6,
): Level[] {
  if (!pivots.length || !price) return [];
  const clusters: Array<{ sum: number; n: number; kind: "high" | "low" }> = [];

  for (const p of pivots) {
    const hit = clusters.find(
      (c) => Math.abs(c.sum / c.n - p.price) / p.price <= tolerance,
    );
    if (hit) {
      hit.sum += p.price;
      hit.n += 1;
    } else {
      clusters.push({ sum: p.price, n: 1, kind: p.kind });
    }
  }

  return clusters
    .map((c) => {
      const lvl = c.sum / c.n;
      return {
        price: lvl,
        // Classified by position relative to price, not by pivot type: broken
        // resistance becomes support (the flip), which is the whole point.
        kind: (lvl < price ? "support" : "resistance") as "support" | "resistance",
        touches: c.n,
        distancePct: ((lvl - price) / price) * 100,
      };
    })
    .sort(
      (a, b) =>
        b.touches - a.touches || Math.abs(a.distancePct) - Math.abs(b.distancePct),
    )
    .slice(0, max);
}

export interface LiquidityZone {
  price: number;
  side: "buy-side" | "sell-side";
  detail: string;
}

/**
 * Equal highs / equal lows — where stop orders pile up. Price is drawn to
 * these before it reverses, which is why a "breakout" into one so often fails.
 */
export function liquidityZones(
  pivots: Pivot[],
  price: number,
  tolerance = 0.008,
): LiquidityZone[] {
  const out: LiquidityZone[] = [];
  const highs = pivots.filter((p) => p.kind === "high");
  const lows = pivots.filter((p) => p.kind === "low");

  for (let i = 1; i < highs.length; i++) {
    const a = highs[i - 1].price;
    const b = highs[i].price;
    if (Math.abs(a - b) / b <= tolerance && b > price) {
      out.push({
        price: Math.max(a, b),
        side: "buy-side",
        detail:
          "Equal highs near " + b.toPrecision(4) +
          " — stop orders resting above; price often sweeps this before reversing.",
      });
    }
  }
  for (let i = 1; i < lows.length; i++) {
    const a = lows[i - 1].price;
    const b = lows[i].price;
    if (Math.abs(a - b) / b <= tolerance && b < price) {
      out.push({
        price: Math.min(a, b),
        side: "sell-side",
        detail:
          "Equal lows near " + b.toPrecision(4) +
          " — stop orders resting below; expect a sweep before any bounce.",
      });
    }
  }
  return out.slice(-4);
}

export interface FibView {
  swingHigh: number;
  swingLow: number;
  direction: "up" | "down";
  levels: Array<{ ratio: number; price: number }>;
  /** Which retracement band price currently sits in, if any. */
  inZone: string | null;
  detail: string;
}

const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786];

/**
 * Fibonacci retracement of the most recent completed leg. The 38.2%–78.6% band
 * is the "discount" area where continuation entries are taken.
 */
export function fibRetracement(
  pivots: Pivot[],
  price: number,
): FibView | null {
  if (pivots.length < 2) return null;
  const last = pivots[pivots.length - 1];
  const prev = pivots[pivots.length - 2];
  if (last.kind === prev.kind) return null;

  const high = Math.max(last.price, prev.price);
  const low = Math.min(last.price, prev.price);
  const span = high - low;
  if (span <= 0) return null;

  const direction: "up" | "down" = last.kind === "high" ? "up" : "down";
  const levels = FIB_RATIOS.map((ratio) => ({
    ratio,
    // Retracing DOWN from a high, or UP from a low.
    price: direction === "up" ? high - span * ratio : low + span * ratio,
  }));

  let inZone: string | null = null;
  const golden = levels.filter((l) => l.ratio >= 0.382 && l.ratio <= 0.786);
  const lo = Math.min(...golden.map((l) => l.price));
  const hi = Math.max(...golden.map((l) => l.price));
  if (price >= lo && price <= hi) {
    inZone = direction === "up" ? "golden pocket (pullback buy zone)" : "golden pocket (bounce sell zone)";
  }

  const detail =
    "Leg " + low.toPrecision(4) + " → " + high.toPrecision(4) +
    (inZone
      ? ". Price is inside the " + inZone + "."
      : ". Price is outside the 38.2–78.6% retracement band.");

  return { swingHigh: high, swingLow: low, direction, levels, inZone, detail };
}

export interface SuperTrend {
  value: number;
  direction: "up" | "down";
  /** Bars since the last flip — a fresh flip is the actionable event. */
  barsSinceFlip: number;
  flipped: boolean;
  detail: string;
}

/**
 * SuperTrend (ATR bands). The classic trend filter: pair it with ZigZag swings
 * and you only take swing entries in the direction the band allows.
 */
export function superTrend(
  candles: Candle[],
  period = 10,
  multiplier = 3,
): SuperTrend | null {
  if (candles.length < period + 2) return null;

  // Wilder ATR series.
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    tr.push(
      Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)),
    );
  }
  if (tr.length < period) return null;

  const atr: Array<number | null> = new Array(candles.length).fill(null);
  let a = 0;
  for (let i = 0; i < period; i++) a += tr[i];
  a /= period;
  atr[period] = a;
  for (let i = period; i < tr.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
    atr[i + 1] = a;
  }

  let upper = 0;
  let lower = 0;
  let dir: "up" | "down" = "up";
  let lastFlip = period;

  for (let i = period; i < candles.length; i++) {
    const c = candles[i];
    const cur = atr[i];
    if (cur == null) continue;
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + multiplier * cur;
    const basicLower = hl2 - multiplier * cur;
    const prevClose = candles[i - 1].close;

    // Bands only tighten in the direction of the trend — they never loosen,
    // which is what stops SuperTrend from whipsawing on every bar.
    upper =
      basicUpper < upper || prevClose > upper || upper === 0 ? basicUpper : upper;
    lower =
      basicLower > lower || prevClose < lower || lower === 0 ? basicLower : lower;

    const prevDir: "up" | "down" = dir;
    if (c.close > upper) dir = "up";
    else if (c.close < lower) dir = "down";
    if (dir !== prevDir) lastFlip = i;
  }

  const lastIdx = candles.length - 1;
  const barsSinceFlip = lastIdx - lastFlip;
  const value = dir === "up" ? lower : upper;

  return {
    value,
    direction: dir,
    barsSinceFlip,
    flipped: barsSinceFlip <= 2,
    detail:
      "SuperTrend is " + dir +
      " with the band at " + value.toPrecision(4) +
      (barsSinceFlip <= 2
        ? " — it flipped " + barsSinceFlip + " bars ago (fresh signal)."
        : " — stable for " + barsSinceFlip + " bars."),
  };
}
