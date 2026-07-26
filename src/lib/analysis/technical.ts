// Technical analysis engine (pure functions over real OHLCV).
//
// ── Why this file was rewritten ────────────────────────────────────────────
// The previous version produced *confident-looking but meaningless* output on
// short candle series, which is the #1 reason signals felt random:
//
//  1. `ema()` seeded the series with `values[0]` and returned a value even when
//     there were fewer candles than the period. A 3-candle token therefore got
//     a real-looking "EMA50", so `trend` flipped to up/down on noise.
//  2. `rsi()` used a simple average instead of Wilder smoothing, so RSI drifted
//     from every charting platform's value (and from the AI's expectations).
//  3. `macd()` inherited the same unseeded EMA bias.
//  4. Patterns were detected from as few as 20 candles with only 2-3 swings.
//
// Every indicator now returns `null` unless it has enough data to be valid.
// `null` is meaningful: the signal engine treats missing indicators as absence
// of evidence rather than as neutral evidence.
import type { Candle, Indicators, ChartPattern } from "../types";

// Confirmation buffer so tiny wicks don't trigger false pattern breaks.
const CONFIRM_BUFFER = 0.003; // 0.3%

// Minimum candles required before we trust pattern geometry at all.
const MIN_PATTERN_CANDLES = 30;

/**
 * Exponential moving average.
 *
 * Seeded with the SMA of the first `period` values (standard practice) and only
 * defined from index `period - 1` onward. Entries before that are `null` so
 * callers can never accidentally read a warm-up value as a real EMA.
 */
function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Last non-null value of a series, or null. */
function lastDefined(a: Array<number | null>): number | null {
  for (let i = a.length - 1; i >= 0; i--) {
    const v = a[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

/** Final EMA value, or null when there isn't enough data. */
function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return lastDefined(emaSeries(values, period));
}

/**
 * Wilder's RSI — the same smoothing TradingView/DexScreener-era tools use.
 * Needs at least `period + 1` closes; returns null otherwise.
 */
function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  // Seed with the simple average of the first `period` changes.
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  // Wilder smoothing across the remainder.
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  const value = 100 - 100 / (1 + rs);
  return Number.isFinite(value) ? value : null;
}

/**
 * MACD(12, 26, 9). Requires 26 candles for the slow EMA plus 9 more for the
 * signal line to be meaningful, so we demand 35 closes.
 */
function macd(closes: number[]): {
  macd: number | null;
  signal: number | null;
  hist: number | null;
} {
  const empty = { macd: null, signal: null, hist: null };
  if (closes.length < 35) return empty;

  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);

  // MACD line only exists where BOTH EMAs are defined.
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f != null && s != null) macdLine.push(f - s);
  }
  if (macdLine.length < 9) return empty;

  const signalLine = emaSeries(macdLine, 9);
  const m = macdLine[macdLine.length - 1];
  const s = lastDefined(signalLine);
  if (m == null || s == null) return empty;
  return { macd: m, signal: s, hist: m - s };
}

/** Wilder's ATR. Returns null without `period + 1` candles. */
function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trueRanges.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close),
      ),
    );
  }
  if (trueRanges.length < period) return null;

  let value = 0;
  for (let i = 0; i < period; i++) value += trueRanges[i];
  value /= period;
  for (let i = period; i < trueRanges.length; i++) {
    value = (value * (period - 1) + trueRanges[i]) / period;
  }
  return Number.isFinite(value) ? value : null;
}

// Local extrema (swing highs/lows) with a small neighbour window.
function swingHighs(candles: Candle[], w = 2): number[] {
  const idx: number[] = [];
  for (let i = w; i < candles.length - w; i++) {
    let isHigh = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j !== i && candles[j].high > candles[i].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) idx.push(i);
  }
  return idx;
}

function swingLows(candles: Candle[], w = 2): number[] {
  const idx: number[] = [];
  for (let i = w; i < candles.length - w; i++) {
    let isLow = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j !== i && candles[j].low < candles[i].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) idx.push(i);
  }
  return idx;
}

export function computeIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((c) => c.close).filter((c) => Number.isFinite(c));

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const m = macd(closes);
  const atr14 = atr(candles);
  const price = closes.length ? closes[closes.length - 1] : null;

  // Support/resistance needs real swing structure, not just any 3 bars.
  const highs = swingHighs(candles).map((i) => candles[i].high);
  const lows = swingLows(candles).map((i) => candles[i].low);
  const resistance = highs.length >= 1 ? Math.max(...highs.slice(-3)) : null;
  const support = lows.length >= 1 ? Math.min(...lows.slice(-3)) : null;

  // Trend requires the FULL EMA stack. Without EMA50 (i.e. <50 candles) we fall
  // back to the 9/21 relationship but demand a real separation so a flat tape
  // isn't reported as a trend.
  let trend: Indicators["trend"] = "sideways";
  if (ema9 != null && ema21 != null && ema50 != null) {
    if (ema9 > ema21 && ema21 > ema50) trend = "up";
    else if (ema9 < ema21 && ema21 < ema50) trend = "down";
  } else if (ema9 != null && ema21 != null && ema21 !== 0) {
    const sep = (ema9 - ema21) / ema21;
    if (sep > 0.01) trend = "up";
    else if (sep < -0.01) trend = "down";
  }

  return {
    ema9,
    ema21,
    ema50,
    rsi14: rsi(closes),
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    atr14,
    support,
    resistance,
    trend,
    candleCount: candles.length,
    atrPct: atr14 != null && price ? (atr14 / price) * 100 : null,
  };
}

function near(a: number, b: number, tol = 0.02): boolean {
  if (b === 0) return false;
  return Math.abs(a - b) / b <= tol;
}

/**
 * Detect classic chart patterns.
 *
 * Requires MIN_PATTERN_CANDLES bars — below that, "patterns" are just noise and
 * were previously injecting up to ±18 points of fake conviction per pattern.
 */
export function detectPatterns(candles: Candle[]): ChartPattern[] {
  const patterns: ChartPattern[] = [];
  if (candles.length < MIN_PATTERN_CANDLES) return patterns;

  const hiIdx = swingHighs(candles);
  const loIdx = swingLows(candles);
  const price = candles[candles.length - 1].close;

  // Triple / Double Top — repeated highs at a similar level (bearish).
  const recentHighs = hiIdx.slice(-3).map((i) => candles[i].high);
  if (
    recentHighs.length === 3 &&
    near(recentHighs[0], recentHighs[1]) &&
    near(recentHighs[1], recentHighs[2])
  ) {
    patterns.push({
      name: "Triple Top",
      direction: "bearish",
      confidence: 0.6,
      detail: `Three rejections near ${recentHighs[2].toPrecision(4)} — supply zone overhead.`,
    });
  } else if (
    recentHighs.length >= 2 &&
    near(recentHighs[recentHighs.length - 2], recentHighs[recentHighs.length - 1])
  ) {
    patterns.push({
      name: "Double Top",
      direction: "bearish",
      confidence: 0.5,
      detail: `Two rejections near ${recentHighs[recentHighs.length - 1].toPrecision(4)}.`,
    });
  }

  // Triple / Double Bottom — repeated lows at a similar level (bullish).
  const recentLows = loIdx.slice(-3).map((i) => candles[i].low);
  if (
    recentLows.length === 3 &&
    near(recentLows[0], recentLows[1]) &&
    near(recentLows[1], recentLows[2])
  ) {
    patterns.push({
      name: "Triple Bottom",
      direction: "bullish",
      confidence: 0.6,
      detail: `Three defenses near ${recentLows[2].toPrecision(4)} — demand zone building.`,
    });
  } else if (
    recentLows.length >= 2 &&
    near(recentLows[recentLows.length - 2], recentLows[recentLows.length - 1])
  ) {
    patterns.push({
      name: "Double Bottom",
      direction: "bullish",
      confidence: 0.5,
      detail: `Two defenses near ${recentLows[recentLows.length - 1].toPrecision(4)}.`,
    });
  }

  // Symmetrical Triangle — lower highs + higher lows converging.
  if (hiIdx.length >= 2 && loIdx.length >= 2) {
    const h = hiIdx.slice(-2).map((i) => candles[i].high);
    const l = loIdx.slice(-2).map((i) => candles[i].low);
    const lowerHighs = h[1] < h[0] * (1 - CONFIRM_BUFFER);
    const higherLows = l[1] > l[0] * (1 + CONFIRM_BUFFER);
    if (lowerHighs && higherLows) {
      patterns.push({
        name: "Symmetrical Triangle",
        direction: "neutral",
        confidence: 0.45,
        detail:
          "Range compressing — expect a volatility expansion; trade the breakout.",
      });
    }
  }

  // Breakout — price closes above recent resistance with buffer. We use the
  // highest of the last few swing highs, not merely the most recent one, so a
  // minor pullback high doesn't register as a breakout.
  const priorHighs = hiIdx.slice(-3).map((i) => candles[i].high);
  const priorHigh = priorHighs.length ? Math.max(...priorHighs) : null;
  if (priorHigh && price > priorHigh * (1 + CONFIRM_BUFFER)) {
    patterns.push({
      name: "Resistance Breakout",
      direction: "bullish",
      confidence: 0.55,
      detail: `Price cleared ${priorHigh.toPrecision(4)} — prior resistance may flip to support.`,
    });
  }
  const priorLows = loIdx.slice(-3).map((i) => candles[i].low);
  const priorLow = priorLows.length ? Math.min(...priorLows) : null;
  if (priorLow && price < priorLow * (1 - CONFIRM_BUFFER)) {
    patterns.push({
      name: "Support Breakdown",
      direction: "bearish",
      confidence: 0.55,
      detail: `Price lost ${priorLow.toPrecision(4)} — support broke.`,
    });
  }

  return patterns;
}

export const TECHNICAL_LIMITS = {
  MIN_PATTERN_CANDLES,
  /** Below this we consider the chart unusable for a directional call. */
  MIN_SIGNAL_CANDLES: 20,
  /** At/above this we treat the chart as fully reliable. */
  GOOD_SIGNAL_CANDLES: 60,
};
