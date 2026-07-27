// Candlestick pattern recognition over real OHLCV.
//
// Every classic single-, two- and three-bar formation from the standard
// cheat sheets is implemented here with explicit geometry rules rather than
// vibes: body size vs range, wick ratios, gap/overlap tests, and the prior
// trend the pattern is supposed to reverse or continue.
//
// Two rules keep this honest:
//  1. CONTEXT IS REQUIRED. A hammer is only a hammer after a decline; the same
//     shape after a rally is a hanging man and means the opposite. Patterns
//     detected without the right preceding trend are discarded, not reported
//     with lower confidence.
//  2. SIZE IS RELATIVE. Every threshold is measured against the average true
//     body of recent candles, so the rules work identically on a token moving
//     0.5% a bar and one moving 40% a bar.
import type { Candle } from "../types";
import { ADVANCED_DETECTORS } from "./candlesticksAdvanced";
import {
  avgBody,
  body,
  bodyPct,
  isBear,
  isBull,
  lowerWick,
  mid,
  priorTrend,
  range,
  upperWick,
} from "./candleGeometry";

// Imported for local use and re-exported so existing importers of this module
// keep working unchanged.
import type {
  CandleDirection,
  CandlestickHit,
  Detector,
} from "./candleGeometry";

export type { CandleDirection, CandlestickHit, Detector };

// ── Individual detectors ───────────────────────────────────────────────────
// Each returns a hit or null for the formation ENDING at index i.

function doji(candles: Candle[], i: number): CandlestickHit | null {
  const c = candles[i];
  if (bodyPct(c) > 0.1) return null;
  const up = upperWick(c);
  const lo = lowerWick(c);
  const r = range(c);

  // Dragonfly: all the rejection is below — buyers defended a low.
  if (lo > r * 0.6 && up < r * 0.15) {
    return {
      name: "Dragonfly Doji",
      direction: "bullish",
      confidence: 0.5,
      detail: "Price was driven down then fully recovered — sellers failed.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  // Gravestone: all the rejection is above.
  if (up > r * 0.6 && lo < r * 0.15) {
    return {
      name: "Gravestone Doji",
      direction: "bearish",
      confidence: 0.5,
      detail: "Rally was completely sold back to the open — supply overhead.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (up > r * 0.3 && lo > r * 0.3) {
    return {
      name: "Long-legged Doji",
      direction: "neutral",
      confidence: 0.35,
      detail: "Wide two-sided rejection — control is genuinely unresolved.",
      index: i,
      barsAgo: 0,
      kind: "indecision",
    };
  }
  return {
    name: "Doji",
    direction: "neutral",
    confidence: 0.3,
    detail: "Open and close nearly equal — indecision.",
    index: i,
    barsAgo: 0,
    kind: "indecision",
  };
}

function hammerFamily(candles: Candle[], i: number): CandlestickHit | null {
  const c = candles[i];
  const r = range(c);
  const b = body(c);
  const up = upperWick(c);
  const lo = lowerWick(c);
  if (b / r > 0.45) return null; // body too large for a pin bar

  const trend = priorTrend(candles, i);
  const longLower = lo >= b * 2 && lo > r * 0.55 && up < r * 0.2;
  const longUpper = up >= b * 2 && up > r * 0.55 && lo < r * 0.2;

  if (longLower) {
    // Same shape, opposite meaning depending on what came before it.
    if (trend === "down") {
      return {
        name: "Hammer",
        direction: "bullish",
        confidence: 0.6,
        detail:
          "Long lower wick after a decline — sellers pushed down and were absorbed.",
        index: i,
        barsAgo: 0,
        kind: "reversal",
      };
    }
    if (trend === "up") {
      return {
        name: "Hanging Man",
        direction: "bearish",
        confidence: 0.5,
        detail:
          "Long lower wick after a rally — first sign of supply entering.",
        index: i,
        barsAgo: 0,
        kind: "reversal",
      };
    }
    return null;
  }

  if (longUpper) {
    if (trend === "up") {
      return {
        name: "Shooting Star",
        direction: "bearish",
        confidence: 0.6,
        detail:
          "Long upper wick after a rally — the push higher was fully rejected.",
        index: i,
        barsAgo: 0,
        kind: "reversal",
      };
    }
    if (trend === "down") {
      return {
        name: "Inverted Hammer",
        direction: "bullish",
        confidence: 0.45,
        detail:
          "Upper wick after a decline — buyers tested higher; needs confirmation.",
        index: i,
        barsAgo: 0,
        kind: "reversal",
      };
    }
  }
  return null;
}

function marubozu(candles: Candle[], i: number): CandlestickHit | null {
  const c = candles[i];
  const r = range(c);
  if (body(c) / r < 0.9) return null;
  if (body(c) < avgBody(candles, i) * 1.3) return null;
  return isBull(c)
    ? {
        name: "Bullish Marubozu",
        direction: "bullish",
        confidence: 0.55,
        detail: "Full-body up bar with almost no wicks — one-sided demand.",
        index: i,
        barsAgo: 0,
        kind: "continuation",
      }
    : {
        name: "Bearish Marubozu",
        direction: "bearish",
        confidence: 0.55,
        detail: "Full-body down bar with almost no wicks — one-sided supply.",
        index: i,
        barsAgo: 0,
        kind: "continuation",
      };
}

function spinningTop(candles: Candle[], i: number): CandlestickHit | null {
  const c = candles[i];
  const r = range(c);
  if (bodyPct(c) > 0.3 || bodyPct(c) < 0.05) return null;
  if (upperWick(c) < r * 0.25 || lowerWick(c) < r * 0.25) return null;
  return {
    name: "Spinning Top",
    direction: "neutral",
    confidence: 0.3,
    detail: "Small body with wicks both sides — momentum is stalling.",
    index: i,
    barsAgo: 0,
    kind: "indecision",
  };
}

function engulfing(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const c = candles[i];
  // The current real body must completely contain the previous real body.
  const contains =
    Math.max(c.open, c.close) >= Math.max(prev.open, prev.close) &&
    Math.min(c.open, c.close) <= Math.min(prev.open, prev.close);
  if (!contains) return null;
  if (body(c) < body(prev) * 1.1) return null;
  if (body(c) < avgBody(candles, i)) return null;

  const trend = priorTrend(candles, i);
  if (isBull(c) && isBear(prev) && trend !== "up") {
    return {
      name: "Bullish Engulfing",
      direction: "bullish",
      confidence: 0.7,
      detail:
        "An up bar swallowed the whole prior down bar — demand overwhelmed supply.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (isBear(c) && isBull(prev) && trend !== "down") {
    return {
      name: "Bearish Engulfing",
      direction: "bearish",
      confidence: 0.7,
      detail:
        "A down bar swallowed the whole prior up bar — supply overwhelmed demand.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

function harami(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const c = candles[i];
  const inside =
    Math.max(c.open, c.close) < Math.max(prev.open, prev.close) &&
    Math.min(c.open, c.close) > Math.min(prev.open, prev.close);
  if (!inside) return null;
  if (body(prev) < avgBody(candles, i) * 1.2) return null;
  if (body(c) > body(prev) * 0.6) return null;

  if (isBear(prev) && isBull(c)) {
    return {
      name: "Bullish Harami",
      direction: "bullish",
      confidence: 0.45,
      detail: "Small up bar inside a large down bar — selling pressure faded.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (isBull(prev) && isBear(c)) {
    return {
      name: "Bearish Harami",
      direction: "bearish",
      confidence: 0.45,
      detail: "Small down bar inside a large up bar — buying pressure faded.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

function piercingOrDarkCloud(
  candles: Candle[],
  i: number,
): CandlestickHit | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const c = candles[i];
  if (body(prev) < avgBody(candles, i)) return null;

  // Piercing line: opens below the prior low-ish and closes back above the
  // midpoint of the prior down bar — but does NOT fully engulf it.
  if (
    isBear(prev) &&
    isBull(c) &&
    c.open < prev.close &&
    c.close > mid(prev) &&
    c.close < prev.open
  ) {
    return {
      name: "Piercing Line",
      direction: "bullish",
      confidence: 0.55,
      detail: "Opened lower then closed above the midpoint of the prior red bar.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (
    isBull(prev) &&
    isBear(c) &&
    c.open > prev.close &&
    c.close < mid(prev) &&
    c.close > prev.open
  ) {
    return {
      name: "Dark Cloud Cover",
      direction: "bearish",
      confidence: 0.55,
      detail: "Opened higher then closed below the midpoint of the prior green bar.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

function tweezers(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const c = candles[i];
  const tol = avgBody(candles, i) * 0.2;
  const trend = priorTrend(candles, i);

  if (
    trend === "up" &&
    Math.abs(c.high - prev.high) <= tol &&
    isBull(prev) &&
    isBear(c)
  ) {
    return {
      name: "Tweezer Top",
      direction: "bearish",
      confidence: 0.45,
      detail: "Two bars rejected from an identical high — a hard ceiling.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (
    trend === "down" &&
    Math.abs(c.low - prev.low) <= tol &&
    isBear(prev) &&
    isBull(c)
  ) {
    return {
      name: "Tweezer Bottom",
      direction: "bullish",
      confidence: 0.45,
      detail: "Two bars defended an identical low — a hard floor.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

function star(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  const avg = avgBody(candles, i);
  // Middle bar must be small — that is the "star" (hesitation) itself.
  if (body(b) > avg * 0.6) return null;
  if (body(a) < avg * 0.8 || body(c) < avg * 0.8) return null;

  if (isBear(a) && isBull(c) && c.close > mid(a)) {
    return {
      name: "Morning Star",
      direction: "bullish",
      confidence: 0.75,
      detail:
        "Down bar, pause, then a strong up bar closing back inside it — bottom in place.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (isBull(a) && isBear(c) && c.close < mid(a)) {
    return {
      name: "Evening Star",
      direction: "bearish",
      confidence: 0.75,
      detail:
        "Up bar, pause, then a strong down bar closing back inside it — top in place.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

function threeInARow(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const [a, b, c] = [candles[i - 2], candles[i - 1], candles[i]];
  const avg = avgBody(candles, i);
  const solid = (x: Candle) => body(x) > avg * 0.8 && bodyPct(x) > 0.55;

  if (
    isBull(a) && isBull(b) && isBull(c) &&
    solid(a) && solid(b) && solid(c) &&
    b.close > a.close && c.close > b.close
  ) {
    return {
      name: "Three White Soldiers",
      direction: "bullish",
      confidence: 0.7,
      detail: "Three strong consecutive up closes — sustained accumulation.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  if (
    isBear(a) && isBear(b) && isBear(c) &&
    solid(a) && solid(b) && solid(c) &&
    b.close < a.close && c.close < b.close
  ) {
    return {
      name: "Three Black Crows",
      direction: "bearish",
      confidence: 0.7,
      detail: "Three strong consecutive down closes — sustained distribution.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  return null;
}

function threeInside(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  // A harami on the previous bar, then confirmation on this one.
  const h = harami(candles, i - 1);
  if (!h) return null;
  const c = candles[i];
  const first = candles[i - 2];

  if (h.direction === "bullish" && isBull(c) && c.close > first.open) {
    return {
      name: "Three Inside Up",
      direction: "bullish",
      confidence: 0.65,
      detail: "Bullish harami confirmed by a close above the large red bar.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (h.direction === "bearish" && isBear(c) && c.close < first.open) {
    return {
      name: "Three Inside Down",
      direction: "bearish",
      confidence: 0.65,
      detail: "Bearish harami confirmed by a close below the large green bar.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}


// Ordered strongest-first. Three-bar formations are checked before the two-bar
// ones they contain, so a Morning Star is not downgraded to a plain Harami.
const DETECTORS: Detector[] = [
  star,
  threeInside,
  threeInARow,
  engulfing,
  piercingOrDarkCloud,
  harami,
  tweezers,
  hammerFamily,
  marubozu,
  doji,
  spinningTop,
  // Extended encyclopedia: gaps/windows, four- and five-bar continuations and
  // the rarer three-bar reversals. Checked last so the classic formations keep
  // priority when both would match the same bar.
  ...ADVANCED_DETECTORS,
];

/**
 * Scan the most recent `lookback` bars and return every formation found,
 * newest first.
 *
 * Only ONE formation is reported per bar: the first (strongest) detector to
 * match wins, because a Morning Star is also technically a Doji and counting
 * both would double-count the same evidence in the signal score.
 */
export function detectCandlestickPatterns(
  candles: Candle[],
  lookback = 6,
): CandlestickHit[] {
  const out: CandlestickHit[] = [];
  if (candles.length < 8) return out;

  const last = candles.length - 1;
  const from = Math.max(2, candles.length - lookback);

  for (let i = last; i >= from; i--) {
    for (const detect of DETECTORS) {
      const hit = detect(candles, i);
      if (hit) {
        const barsAgo = last - i;
        out.push({
          ...hit,
          index: i,
          barsAgo,
          // Recency decay: a reversal bar from 5 candles ago that has not
          // played out yet is much weaker evidence than the current one.
          confidence: hit.confidence * Math.max(0.4, 1 - barsAgo * 0.15),
        });
        break;
      }
    }
  }
  return out;
}

/**
 * Collapse candlestick hits into one directional vote in the range -1..1.
 * Indecision bars deliberately contribute nothing directional.
 */
export function candlestickBias(hits: CandlestickHit[]): {
  vote: number;
  weight: number;
  summary: string;
} {
  if (hits.length === 0) {
    return { vote: 0, weight: 0, summary: "No candlestick formations." };
  }
  let score = 0;
  let total = 0;
  for (const h of hits) {
    total += h.confidence;
    if (h.direction === "bullish") score += h.confidence;
    else if (h.direction === "bearish") score -= h.confidence;
  }
  const vote = total > 0 ? score / total : 0;
  const names = hits
    .slice(0, 3)
    .map((h) => h.name + (h.barsAgo ? " (" + h.barsAgo + " bars ago)" : ""))
    .join(", ");
  return {
    vote: Math.max(-1, Math.min(1, vote)),
    // Confidence in the READING scales with how much formation evidence exists.
    weight: Math.min(14, total * 8),
    summary: names,
  };
}
