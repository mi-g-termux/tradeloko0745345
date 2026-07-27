// Shared candlestick geometry primitives.
//
// These live in their own module so both ./candlesticks (classic formations)
// and ./candlesticksAdvanced (the extended encyclopedia) can use them without
// importing each other. Dependencies stay one-way, which avoids a module cycle
// that would otherwise throw at import time depending on load order.
import type { Candle } from "../types";

export type CandleDirection = "bullish" | "bearish" | "neutral";

export interface CandlestickHit {
  name: string;
  direction: CandleDirection;
  /** 0..1 \u2014 geometric quality of the formation, not a probability of profit. */
  confidence: number;
  detail: string;
  /** Index of the LAST candle in the formation. */
  index: number;
  /** How many bars ago the formation completed (0 = the live bar). */
  barsAgo: number;
  /** Reversal formations flip the trend; continuation ones extend it. */
  kind: "reversal" | "continuation" | "indecision";
}

export type Detector = (candles: Candle[], i: number) => CandlestickHit | null;

export const body = (c: Candle) => Math.abs(c.close - c.open);
export const range = (c: Candle) => Math.max(c.high - c.low, Number.EPSILON);
export const upperWick = (c: Candle) => c.high - Math.max(c.open, c.close);
export const lowerWick = (c: Candle) =>
  c.low === c.high ? 0 : Math.min(c.open, c.close) - c.low;
export const isBull = (c: Candle) => c.close > c.open;
export const isBear = (c: Candle) => c.close < c.open;
export const mid = (c: Candle) => (c.open + c.close) / 2;
export const bodyPct = (c: Candle) => body(c) / range(c);

/** Average candle body over the `n` bars ending just before `i`. */
export function avgBody(candles: Candle[], i: number, n = 14): number {
  const start = Math.max(0, i - n);
  if (i - start === 0) return body(candles[i]) || Number.EPSILON;
  let sum = 0;
  for (let j = start; j < i; j++) sum += body(candles[j]);
  return sum / (i - start) || Number.EPSILON;
}

/**
 * Direction of the run leading INTO index `i`, excluding bar `i` itself.
 * Compares the close `n` bars back with the close just before the pattern and
 * requires a move worth at least one average body, so drift is not a trend.
 */
export function priorTrend(
  candles: Candle[],
  i: number,
  n = 5,
): "up" | "down" | "flat" {
  const start = i - n;
  if (start < 0) return "flat";
  const from = candles[start].close;
  const to = candles[i - 1].close;
  const move = to - from;
  const threshold = avgBody(candles, i) * 1.2;
  if (move > threshold) return "up";
  if (move < -threshold) return "down";
  return "flat";
}
