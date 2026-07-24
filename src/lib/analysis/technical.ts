// Technical analysis engine — ported from the Quotex project and rebuilt for
// memecoin candles. Pure functions over OHLCV: EMA, RSI, MACD, ATR,
// support/resistance, trend, plus chart-pattern detection (Triple Top/Bottom,
// Double Top/Bottom, Symmetrical Triangle, breakout).
import type { Candle, Indicators, ChartPattern } from "../types";

// Confirmation buffer so tiny wicks don't trigger false pattern breaks.
const CONFIRM_BUFFER = 0.003; // 0.3%

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function last<T>(a: T[]): T | null {
  return a.length ? a[a.length - 1] : null;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes: number[]): {
  macd: number | null;
  signal: number | null;
  hist: number | null;
} {
  if (closes.length < 35) return { macd: null, signal: null, hist: null };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }
  const signalLine = ema(macdLine, 9);
  const m = last(macdLine);
  const s = last(signalLine);
  if (m == null || s == null) return { macd: null, signal: null, hist: null };
  return { macd: m, signal: s, hist: m - s };
}

function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close),
      ),
    );
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

// Local extrema (swing highs/lows) with a small neighbour window.
function swingHighs(candles: Candle[], w = 2): number[] {
  const idx: number[] = [];
  for (let i = w; i < candles.length - w; i++) {
    let isHigh = true;
    for (let j = i - w; j <= i + w; j++) {
      if (candles[j].high > candles[i].high) {
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
      if (candles[j].low < candles[i].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) idx.push(i);
  }
  return idx;
}

export function computeIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((c) => c.close);
  const ema9 = last(ema(closes, 9));
  const ema21 = last(ema(closes, 21));
  const ema50 = last(ema(closes, 50));
  const m = macd(closes);

  const highs = swingHighs(candles).map((i) => candles[i].high);
  const lows = swingLows(candles).map((i) => candles[i].low);
  const resistance = highs.length ? Math.max(...highs.slice(-3)) : null;
  const support = lows.length ? Math.min(...lows.slice(-3)) : null;

  let trend: Indicators["trend"] = "sideways";
  if (ema9 != null && ema21 != null && ema50 != null) {
    if (ema9 > ema21 && ema21 > ema50) trend = "up";
    else if (ema9 < ema21 && ema21 < ema50) trend = "down";
  }

  return {
    ema9,
    ema21,
    ema50,
    rsi14: rsi(closes),
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    atr14: atr(candles),
    support,
    resistance,
    trend,
  };
}

function near(a: number, b: number, tol = 0.02): boolean {
  if (b === 0) return false;
  return Math.abs(a - b) / b <= tol;
}

/** Detect a handful of classic chart patterns. */
export function detectPatterns(candles: Candle[]): ChartPattern[] {
  const patterns: ChartPattern[] = [];
  if (candles.length < 20) return patterns;

  const hiIdx = swingHighs(candles);
  const loIdx = swingLows(candles);
  const price = candles[candles.length - 1].close;

  // Triple / Double Top — repeated highs at a similar level (bearish).
  const recentHighs = hiIdx.slice(-3).map((i) => candles[i].high);
  if (recentHighs.length === 3 && near(recentHighs[0], recentHighs[1]) && near(recentHighs[1], recentHighs[2])) {
    patterns.push({
      name: "Triple Top",
      direction: "bearish",
      confidence: 0.6,
      detail: `Three rejections near ${recentHighs[2].toPrecision(4)} — supply zone overhead.`,
    });
  } else if (recentHighs.length >= 2 && near(recentHighs[recentHighs.length - 2], recentHighs[recentHighs.length - 1])) {
    patterns.push({
      name: "Double Top",
      direction: "bearish",
      confidence: 0.5,
      detail: `Two rejections near ${recentHighs[recentHighs.length - 1].toPrecision(4)}.`,
    });
  }

  // Triple / Double Bottom — repeated lows at a similar level (bullish).
  const recentLows = loIdx.slice(-3).map((i) => candles[i].low);
  if (recentLows.length === 3 && near(recentLows[0], recentLows[1]) && near(recentLows[1], recentLows[2])) {
    patterns.push({
      name: "Triple Bottom",
      direction: "bullish",
      confidence: 0.6,
      detail: `Three defenses near ${recentLows[2].toPrecision(4)} — demand zone building.`,
    });
  } else if (recentLows.length >= 2 && near(recentLows[recentLows.length - 2], recentLows[recentLows.length - 1])) {
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
        detail: "Range compressing — expect a volatility expansion; trade the breakout.",
      });
    }
  }

  // Breakout — price closes above recent resistance with buffer.
  const priorHigh = hiIdx.length ? candles[hiIdx[hiIdx.length - 1]].high : null;
  if (priorHigh && price > priorHigh * (1 + CONFIRM_BUFFER)) {
    patterns.push({
      name: "Resistance Breakout",
      direction: "bullish",
      confidence: 0.55,
      detail: `Price cleared ${priorHigh.toPrecision(4)} — prior resistance may flip to support.`,
    });
  }
  const priorLow = loIdx.length ? candles[loIdx[loIdx.length - 1]].low : null;
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
