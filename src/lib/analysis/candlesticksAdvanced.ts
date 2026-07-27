// Extended candlestick formations: the gap/window family, four- and five-bar
// continuation patterns, and the rarer three-bar reversals from the full
// formation encyclopedia.
//
// These reuse the geometry helpers from ./candlesticks so the same two rules
// apply everywhere: context is required, and every size threshold is measured
// relative to the token's own average body rather than an absolute price.
//
// Import direction is one-way (advanced -> core) so there is no module cycle.
import type { Candle } from "../types";
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
  type CandlestickHit,
  type Detector,
} from "./candleGeometry";

// A "window" in candlestick terms is a true gap: no overlap at all between the
// two bars' full ranges. On a 24/7 market these appear on thin liquidity and
// mark violent repricing, which is why they act as support/resistance later.
const gapUp = (prev: Candle, cur: Candle) => cur.low > prev.high;
const gapDown = (prev: Candle, cur: Candle) => cur.high < prev.low;

/** Body-only gap, ignoring wicks. Used by the star and Tasuki formations. */
const bodyGapUp = (prev: Candle, cur: Candle) =>
  Math.min(cur.open, cur.close) > Math.max(prev.open, prev.close);
const bodyGapDown = (prev: Candle, cur: Candle) =>
  Math.max(cur.open, cur.close) < Math.min(prev.open, prev.close);

const isDoji = (c: Candle) => bodyPct(c) <= 0.1;

/** Rising / Falling Window \u2014 an unfilled gap that becomes a level. */
function window(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const cur = candles[i];
  const avg = avgBody(candles, i);
  if (gapUp(prev, cur)) {
    const size = cur.low - prev.high;
    if (size < avg * 0.3) return null;
    return {
      name: "Rising Window",
      direction: "bullish",
      confidence: 0.5,
      detail:
        "Unfilled gap up \u2014 buyers paid through every offer. The gap floor at " +
        prev.high.toPrecision(4) +
        " now acts as support until it is closed.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  if (gapDown(prev, cur)) {
    const size = prev.low - cur.high;
    if (size < avg * 0.3) return null;
    return {
      name: "Falling Window",
      direction: "bearish",
      confidence: 0.5,
      detail:
        "Unfilled gap down \u2014 bids vanished. The gap ceiling at " +
        prev.low.toPrecision(4) +
        " now caps rallies until it is closed.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  return null;
}

/** Kicking \u2014 opposing marubozu separated by a gap. Very strong, very rare. */
function kicking(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const a = candles[i - 1];
  const b = candles[i];
  if (bodyPct(a) < 0.9 || bodyPct(b) < 0.9) return null;
  if (isBear(a) && isBull(b) && gapUp(a, b)) {
    return {
      name: "Bullish Kicking",
      direction: "bullish",
      confidence: 0.8,
      detail:
        "A full bearish bar followed by a gapped-up full bullish bar \u2014 an outright " +
        "regime change with no overlap. Sentiment reversed instantly.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (isBull(a) && isBear(b) && gapDown(a, b)) {
    return {
      name: "Bearish Kicking",
      direction: "bearish",
      confidence: 0.8,
      detail:
        "A full bullish bar followed by a gapped-down full bearish bar \u2014 holders " +
        "were caught and control flipped without a fight.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

/** Abandoned Baby \u2014 a doji fully gapped away on both sides. */
function abandonedBaby(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (!isDoji(b)) return null;
  const trend = priorTrend(candles, i - 1);
  if (isBear(a) && gapDown(a, b) && gapUp(b, c) && isBull(c) && trend === "down") {
    return {
      name: "Bullish Abandoned Baby",
      direction: "bullish",
      confidence: 0.8,
      detail:
        "Capitulation doji isolated by gaps on both sides after a decline \u2014 the " +
        "selling climax printed and was immediately rejected.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (isBull(a) && gapUp(a, b) && gapDown(b, c) && isBear(c) && trend === "up") {
    return {
      name: "Bearish Abandoned Baby",
      direction: "bearish",
      confidence: 0.8,
      detail:
        "Exhaustion doji isolated by gaps on both sides after a rally \u2014 the top " +
        "was made on the gap and abandoned.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

/** Upside / Downside Tasuki Gap \u2014 a gap that survives a partial fill. */
function tasukiGap(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (isBull(a) && isBull(b) && bodyGapUp(a, b) && isBear(c)) {
    // The counter-bar must open inside b and close inside the gap, not below it.
    if (c.open < Math.max(b.open, b.close) && c.close > Math.max(a.open, a.close)) {
      return {
        name: "Upside Tasuki Gap",
        direction: "bullish",
        confidence: 0.55,
        detail:
          "Profit-taking bar failed to close the gap \u2014 the breakout level held, " +
          "so the uptrend is intact.",
        index: i,
        barsAgo: 0,
        kind: "continuation",
      };
    }
  }
  if (isBear(a) && isBear(b) && bodyGapDown(a, b) && isBull(c)) {
    if (c.open > Math.min(b.open, b.close) && c.close < Math.min(a.open, a.close)) {
      return {
        name: "Downside Tasuki Gap",
        direction: "bearish",
        confidence: 0.55,
        detail:
          "Relief bounce failed to close the gap \u2014 the breakdown level held as " +
          "resistance, so the downtrend is intact.",
        index: i,
        barsAgo: 0,
        kind: "continuation",
      };
    }
  }
  return null;
}

/** Upside Gap Two Crows \u2014 a gapped-up top that gets sold twice. */
function upsideGapTwoCrows(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (priorTrend(candles, i - 2) !== "up") return null;
  if (!isBull(a) || !isBear(b) || !isBear(c)) return null;
  if (!bodyGapUp(a, b)) return null;
  // The second crow engulfs the first but still closes above the gap origin.
  if (c.open <= b.open || c.close >= b.close) return null;
  if (c.close <= Math.max(a.open, a.close)) return null;
  return {
    name: "Upside Gap Two Crows",
    direction: "bearish",
    confidence: 0.6,
    detail:
      "Gapped to a new high then sold on two consecutive bars \u2014 the breakout " +
      "found no follow-through and late buyers are now underwater.",
    index: i,
    barsAgo: 0,
    kind: "reversal",
  };
}

/** Two Black Gapping \u2014 continuation of a decline after a gapped-down pair. */
function twoBlackGapping(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (priorTrend(candles, i - 2) !== "down") return null;
  if (!isBear(b) || !isBear(c)) return null;
  if (!gapDown(a, b)) return null;
  if (c.high >= b.high) return null;
  return {
    name: "Two Black Gapping",
    direction: "bearish",
    confidence: 0.55,
    detail:
      "Gapped down and kept making lower highs \u2014 no bid stepped into the gap, " +
      "which typically precedes continuation.",
    index: i,
    barsAgo: 0,
    kind: "continuation",
  };
}

/** Three Outside Up / Down \u2014 an engulfing bar plus its confirmation bar. */
function threeOutside(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  const trend = priorTrend(candles, i - 1);
  const engulfBull =
    isBear(a) && isBull(b) && b.open <= a.close && b.close >= a.open;
  const engulfBear =
    isBull(a) && isBear(b) && b.open >= a.close && b.close <= a.open;
  if (engulfBull && isBull(c) && c.close > b.close && trend === "down") {
    return {
      name: "Three Outside Up",
      direction: "bullish",
      confidence: 0.7,
      detail:
        "Bullish engulfing followed by a higher close \u2014 the reversal was " +
        "confirmed rather than left as a single hopeful bar.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (engulfBear && isBear(c) && c.close < b.close && trend === "up") {
    return {
      name: "Three Outside Down",
      direction: "bearish",
      confidence: 0.7,
      detail:
        "Bearish engulfing followed by a lower close \u2014 supply confirmed on the " +
        "next bar instead of being absorbed.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

/** Tri-Star \u2014 three consecutive doji. Extreme indecision at an extreme. */
function triStar(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (!isDoji(a) || !isDoji(b) || !isDoji(c)) return null;
  const trend = priorTrend(candles, i - 2, 6);
  if (trend === "flat") return null;
  const bullish = trend === "down";
  return {
    name: bullish ? "Bullish Tri-Star" : "Bearish Tri-Star",
    direction: bullish ? "bullish" : "bearish",
    confidence: 0.6,
    detail:
      "Three consecutive doji after a " +
      (bullish ? "decline" : "rally") +
      " \u2014 the trend has completely run out of participants.",
    index: i,
    barsAgo: 0,
    kind: "reversal",
  };
}

/** Rising / Falling Three Methods \u2014 the classic five-bar continuation. */
function threeMethods(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 4) return null;
  const first = candles[i - 4];
  const mids = [candles[i - 3], candles[i - 2], candles[i - 1]];
  const last = candles[i];
  const avg = avgBody(candles, i - 4);
  if (body(first) < avg || body(last) < avg) return null;

  // The three middle bars must be small and stay INSIDE the first bar's range.
  const contained = mids.every(
    (m) => m.high <= first.high && m.low >= first.low && body(m) < body(first) * 0.6,
  );
  if (!contained) return null;

  if (isBull(first) && isBull(last) && last.close > first.close) {
    return {
      name: "Rising Three Methods",
      direction: "bullish",
      confidence: 0.65,
      detail:
        "A big up bar, three shallow pullback bars that never broke its low, then " +
        "a close above the high \u2014 textbook orderly continuation.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  if (isBear(first) && isBear(last) && last.close < first.close) {
    return {
      name: "Falling Three Methods",
      direction: "bearish",
      confidence: 0.65,
      detail:
        "A big down bar, three weak bounce bars that never broke its high, then a " +
        "close below the low \u2014 the bounce was distribution, not a reversal.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  return null;
}

/** Mat Hold \u2014 a shallower, stronger cousin of Rising Three Methods. */
function matHold(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 4) return null;
  const first = candles[i - 4];
  const mids = [candles[i - 3], candles[i - 2], candles[i - 1]];
  const last = candles[i];
  if (!isBull(first) || !isBull(last)) return null;
  const avg = avgBody(candles, i - 4);
  if (body(first) < avg * 1.2) return null;
  // Pullback stays in the UPPER half of the impulse: buyers never gave ground.
  const floor = first.open + (first.close - first.open) * 0.4;
  if (!mids.every((m) => m.low >= floor && body(m) < body(first) * 0.5)) return null;
  if (last.close <= first.close) return null;
  return {
    name: "Mat Hold",
    direction: "bullish",
    confidence: 0.7,
    detail:
      "Consolidation held the upper half of the impulse before a breakout close \u2014 " +
      "buyers refused to let price retrace, a stronger tell than a normal flag.",
    index: i,
    barsAgo: 0,
    kind: "continuation",
  };
}

/** Three Line Strike \u2014 four bars where one bar swallows the prior three. */
function threeLineStrike(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 3) return null;
  const a = candles[i - 3];
  const b = candles[i - 2];
  const c = candles[i - 1];
  const d = candles[i];
  if (isBull(a) && isBull(b) && isBull(c) && c.close > b.close && b.close > a.close) {
    if (isBear(d) && d.open > c.close && d.close < a.open) {
      return {
        name: "Bearish Three Line Strike",
        direction: "bearish",
        confidence: 0.6,
        detail:
          "One bar erased three days of gains \u2014 usually a liquidity flush rather " +
          "than a true top, so treat it as a warning, not an entry.",
        index: i,
        barsAgo: 0,
        kind: "reversal",
      };
    }
  }
  if (isBear(a) && isBear(b) && isBear(c) && c.close < b.close && b.close < a.close) {
    if (isBull(d) && d.open < c.close && d.close > a.open) {
      return {
        name: "Bullish Three Line Strike",
        direction: "bullish",
        confidence: 0.6,
        detail:
          "One bar reclaimed three bars of losses \u2014 shorts were squeezed out in a " +
          "single move.",
        index: i,
        barsAgo: 0,
        kind: "reversal",
      };
    }
  }
  return null;
}

/** Belt Hold \u2014 an opening marubozu that runs from the extreme. */
function beltHold(candles: Candle[], i: number): CandlestickHit | null {
  const c = candles[i];
  const avg = avgBody(candles, i);
  if (body(c) < avg * 1.3) return null;
  const r = range(c);
  const trend = priorTrend(candles, i);
  if (isBull(c) && lowerWick(c) < r * 0.05 && upperWick(c) < r * 0.25 && trend === "down") {
    return {
      name: "Bullish Belt Hold",
      direction: "bullish",
      confidence: 0.55,
      detail:
        "Opened at the low and never traded below it \u2014 buyers took control from " +
        "the first tick of the bar.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (isBear(c) && upperWick(c) < r * 0.05 && lowerWick(c) < r * 0.25 && trend === "up") {
    return {
      name: "Bearish Belt Hold",
      direction: "bearish",
      confidence: 0.55,
      detail:
        "Opened at the high and never traded above it \u2014 sellers controlled the " +
        "entire bar.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

/** High Wave \u2014 huge two-sided wicks on a tiny body. Volatility, no direction. */
function highWave(candles: Candle[], i: number): CandlestickHit | null {
  const c = candles[i];
  const r = range(c);
  const avg = avgBody(candles, i);
  if (bodyPct(c) > 0.2) return null;
  if (upperWick(c) < r * 0.35 || lowerWick(c) < r * 0.35) return null;
  if (r < avg * 2.5) return null;
  return {
    name: "High Wave",
    direction: "neutral",
    confidence: 0.35,
    detail:
      "Violent two-sided rejection on an unusually wide bar \u2014 volatility expanded " +
      "while conviction collapsed. Position sizing matters more than direction here.",
    index: i,
    barsAgo: 0,
    kind: "indecision",
  };
}

/** On Neck / In Neck \u2014 failed bounces that mark continuation, not reversal. */
function neckLines(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const a = candles[i - 1];
  const c = candles[i];
  if (!isBear(a) || !isBull(c)) return null;
  if (priorTrend(candles, i) !== "down") return null;
  if (c.open >= a.close) return null; // must open below the prior close
  const avg = avgBody(candles, i);
  const nearLow = Math.abs(c.close - a.low) < avg * 0.15;
  const justInside = c.close > a.low && c.close < a.close + body(a) * 0.2;
  if (nearLow) {
    return {
      name: "On Neck",
      direction: "bearish",
      confidence: 0.5,
      detail:
        "The bounce died exactly at the prior bar's low \u2014 buyers could not even " +
        "reach into the previous body. Continuation is the base case.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  if (justInside) {
    return {
      name: "In Neck",
      direction: "bearish",
      confidence: 0.45,
      detail:
        "The bounce barely penetrated the prior bearish body before stalling \u2014 a " +
        "weak response to an oversold bar.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  return null;
}

/** Matching Low \u2014 two identical closes forming a hard floor. */
function matchingLow(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const a = candles[i - 1];
  const c = candles[i];
  if (!isBear(a) || !isBear(c)) return null;
  if (priorTrend(candles, i) !== "down") return null;
  const avg = avgBody(candles, i);
  if (Math.abs(c.close - a.close) > avg * 0.08) return null;
  return {
    name: "Matching Low",
    direction: "bullish",
    confidence: 0.45,
    detail:
      "Two bearish bars closed at the identical price \u2014 a buyer is defending " +
      c.close.toPrecision(4) +
      ". Losing that close invalidates the read.",
    index: i,
    barsAgo: 0,
    kind: "reversal",
  };
}

/** Homing Pigeon \u2014 a bullish harami made of two bearish bars. */
function homingPigeon(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const a = candles[i - 1];
  const c = candles[i];
  if (!isBear(a) || !isBear(c)) return null;
  if (priorTrend(candles, i) !== "down") return null;
  if (c.open >= a.open || c.close <= a.close) return null;
  if (body(c) > body(a) * 0.6) return null;
  return {
    name: "Homing Pigeon",
    direction: "bullish",
    confidence: 0.45,
    detail:
      "Selling continued but at a fraction of the previous bar's size and fully " +
      "inside it \u2014 downside momentum is draining even without a green bar yet.",
    index: i,
    barsAgo: 0,
    kind: "reversal",
  };
}

/** Meeting / Separating Lines \u2014 shared close (reversal) vs shared open (continuation). */
function meetingOrSeparating(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const a = candles[i - 1];
  const c = candles[i];
  const avg = avgBody(candles, i);
  if (body(a) < avg || body(c) < avg) return null;
  const sameClose = Math.abs(a.close - c.close) < avg * 0.08;
  const sameOpen = Math.abs(a.open - c.open) < avg * 0.08;

  if (sameClose && isBear(a) && isBull(c) && priorTrend(candles, i) === "down") {
    return {
      name: "Bullish Meeting Lines",
      direction: "bullish",
      confidence: 0.5,
      detail:
        "A large green bar closed exactly where the previous red bar closed \u2014 " +
        "buyers absorbed the whole prior bar's supply at one price.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (sameClose && isBull(a) && isBear(c) && priorTrend(candles, i) === "up") {
    return {
      name: "Bearish Meeting Lines",
      direction: "bearish",
      confidence: 0.5,
      detail:
        "A large red bar closed exactly where the previous green bar closed \u2014 " +
        "the advance was met with equal and opposite supply.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (sameOpen && isBull(a) && isBull(c) && priorTrend(candles, i) === "up") {
    return {
      name: "Bullish Separating Lines",
      direction: "bullish",
      confidence: 0.45,
      detail:
        "Price reopened at the prior bar's open and pushed up again \u2014 the " +
        "counter-trend bar was fully rejected.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  if (sameOpen && isBear(a) && isBear(c) && priorTrend(candles, i) === "down") {
    return {
      name: "Bearish Separating Lines",
      direction: "bearish",
      confidence: 0.45,
      detail:
        "Price reopened at the prior bar's open and sold off again \u2014 the bounce " +
        "attempt was erased.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  return null;
}

/** Stick Sandwich \u2014 two bearish closes at the same level around a green bar. */
function stickSandwich(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (!isBear(a) || !isBull(b) || !isBear(c)) return null;
  const avg = avgBody(candles, i);
  if (Math.abs(a.close - c.close) > avg * 0.1) return null;
  if (priorTrend(candles, i - 2) !== "down") return null;
  return {
    name: "Stick Sandwich",
    direction: "bullish",
    confidence: 0.5,
    detail:
      "Two bearish bars closed at the same price around a green bar \u2014 that " +
      "repeated close at " +
      c.close.toPrecision(4) +
      " is an accumulation floor.",
    index: i,
    barsAgo: 0,
    kind: "reversal",
  };
}

/** Ladder Bottom \u2014 exhaustion after four consecutive lower closes. */
function ladderBottom(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 4) return null;
  const [a, b, c, d, e] = [
    candles[i - 4],
    candles[i - 3],
    candles[i - 2],
    candles[i - 1],
    candles[i],
  ];
  if (!isBear(a) || !isBear(b) || !isBear(c)) return null;
  if (!(b.close < a.close && c.close < b.close)) return null;
  if (!isBear(d)) return null;
  // The fourth bar shows the first real upper wick: buyers finally probing.
  if (upperWick(d) < body(d) * 0.5) return null;
  if (!isBull(e) || e.open <= d.open) return null;
  return {
    name: "Ladder Bottom",
    direction: "bullish",
    confidence: 0.55,
    detail:
      "A staircase of lower closes, then the first upper wick, then a gap-up green " +
      "bar \u2014 sellers exhausted themselves in an orderly decline.",
    index: i,
    barsAgo: 0,
    kind: "reversal",
  };
}

/** Two Crows \u2014 a gapped-up bar sold back into the prior body. */
function twoCrows(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (priorTrend(candles, i - 2) !== "up") return null;
  if (!isBull(a) || !isBear(b) || !isBear(c)) return null;
  if (!bodyGapUp(a, b)) return null;
  if (c.close >= mid(a) || c.close <= a.open) return null;
  return {
    name: "Two Crows",
    direction: "bearish",
    confidence: 0.55,
    detail:
      "The gap-up high was rejected and price closed back inside the prior body \u2014 " +
      "the breakout trapped buyers.",
    index: i,
    barsAgo: 0,
    kind: "reversal",
  };
}

/** Identical Three Crows \u2014 each bar opens exactly at the previous close. */
function identicalThreeCrows(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (!isBear(a) || !isBear(b) || !isBear(c)) return null;
  const avg = avgBody(candles, i);
  if (Math.abs(b.open - a.close) > avg * 0.08) return null;
  if (Math.abs(c.open - b.close) > avg * 0.08) return null;
  if (!(b.close < a.close && c.close < b.close)) return null;
  return {
    name: "Identical Three Crows",
    direction: "bearish",
    confidence: 0.7,
    detail:
      "Three declining bars each opening exactly at the prior close \u2014 relentless, " +
      "methodical distribution with no bounce allowed.",
    index: i,
    barsAgo: 0,
    kind: "continuation",
  };
}

/** Advance Block / Deliberation \u2014 an uptrend visibly losing thrust. */
function advanceBlock(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (!isBull(a) || !isBull(b) || !isBull(c)) return null;
  if (!(b.close > a.close && c.close > b.close)) return null;
  if (priorTrend(candles, i - 2) !== "up") return null;

  // Deliberation: the third bar's body collapses outright.
  if (body(c) < body(b) * 0.35 && body(b) >= body(a) * 0.6) {
    return {
      name: "Deliberation",
      direction: "bearish",
      confidence: 0.5,
      detail:
        "The third advancing bar's body collapsed \u2014 the trend is still up but the " +
        "buying pressure behind it has stalled.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  // Advance Block: bodies shrink each bar while upper wicks grow.
  const shrinking = body(b) < body(a) * 0.85 && body(c) < body(b) * 0.85;
  const wicksGrowing = upperWick(c) > upperWick(a) && upperWick(c) > body(c) * 0.6;
  if (shrinking && wicksGrowing) {
    return {
      name: "Advance Block",
      direction: "bearish",
      confidence: 0.55,
      detail:
        "Three higher closes with shrinking bodies and growing upper wicks \u2014 each " +
        "push is being sold harder than the last.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

/** Three Stars in the South \u2014 a rare, orderly selling-exhaustion bottom. */
function threeStarsInTheSouth(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (!isBear(a) || !isBear(b) || !isBear(c)) return null;
  if (priorTrend(candles, i - 2) !== "down") return null;
  if (lowerWick(a) < body(a) * 0.4) return null;
  if (!(body(b) < body(a) && body(c) < body(b))) return null;
  if (!(b.low > a.low && c.low >= b.low)) return null;
  if (upperWick(c) > body(c) * 0.3) return null;
  return {
    name: "Three Stars in the South",
    direction: "bullish",
    confidence: 0.6,
    detail:
      "Three shrinking bearish bars with rising lows \u2014 sellers are still in " +
      "control but cannot make a new low. Classic exhaustion.",
    index: i,
    barsAgo: 0,
    kind: "reversal",
  };
}

/** Unique Three River Bottom \u2014 a hammer-like second bar inside a bearish bar. */
function uniqueThreeRiver(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (priorTrend(candles, i - 2) !== "down") return null;
  if (!isBear(a) || !isBear(b)) return null;
  if (b.low >= a.low) return null; // must probe a new low
  if (lowerWick(b) < body(b) * 1.5) return null; // hammer-like rejection
  if (Math.max(b.open, b.close) > Math.max(a.open, a.close)) return null;
  if (!isBull(c) || body(c) > body(b)) return null;
  return {
    name: "Unique Three River Bottom",
    direction: "bullish",
    confidence: 0.55,
    detail:
      "A new low was rejected with a long tail, then a small green bar held above " +
      "it \u2014 the low is being defended rather than accepted.",
    index: i,
    barsAgo: 0,
    kind: "reversal",
  };
}

/** Side-by-Side White Lines \u2014 twin green bars after a gap. */
function sideBySideWhiteLines(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 2) return null;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  if (!isBull(b) || !isBull(c)) return null;
  const avg = avgBody(candles, i);
  if (Math.abs(b.open - c.open) > avg * 0.1) return null;
  if (Math.abs(body(b) - body(c)) > avg * 0.35) return null;
  if (bodyGapUp(a, b) && isBull(a)) {
    return {
      name: "Side-by-Side White Lines",
      direction: "bullish",
      confidence: 0.5,
      detail:
        "Two matching green bars held the gap instead of filling it \u2014 the gap is " +
        "being defended as support.",
      index: i,
      barsAgo: 0,
      kind: "continuation",
    };
  }
  return null;
}

/** Last Engulfing \u2014 an engulfing bar that appears in the WRONG place. */
function lastEngulfing(candles: Candle[], i: number): CandlestickHit | null {
  if (i < 1) return null;
  const a = candles[i - 1];
  const c = candles[i];
  const trend = priorTrend(candles, i, 6);
  // A bearish-engulfing shape at the END of a DOWNTREND is exhaustion, not supply.
  if (isBull(a) && isBear(c) && c.open >= a.close && c.close <= a.open && trend === "down") {
    return {
      name: "Last Engulfing Bottom",
      direction: "bullish",
      confidence: 0.45,
      detail:
        "A bearish engulfing printed after an extended decline \u2014 in that position " +
        "it usually marks capitulation rather than fresh selling.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  if (isBear(a) && isBull(c) && c.open <= a.close && c.close >= a.open && trend === "up") {
    return {
      name: "Last Engulfing Top",
      direction: "bearish",
      confidence: 0.45,
      detail:
        "A bullish engulfing printed after an extended rally \u2014 in that position it " +
        "is often the final blow-off rather than a fresh leg.",
      index: i,
      barsAgo: 0,
      kind: "reversal",
    };
  }
  return null;
}

// Ordered strongest-first, longest formations before the shorter ones they
// contain. Runs AFTER the core detectors, so classics keep priority.
export const ADVANCED_DETECTORS: Detector[] = [
  abandonedBaby,
  kicking,
  threeLineStrike,
  matHold,
  threeMethods,
  ladderBottom,
  threeStarsInTheSouth,
  identicalThreeCrows,
  threeOutside,
  triStar,
  uniqueThreeRiver,
  upsideGapTwoCrows,
  twoBlackGapping,
  twoCrows,
  advanceBlock,
  tasukiGap,
  sideBySideWhiteLines,
  stickSandwich,
  meetingOrSeparating,
  neckLines,
  matchingLow,
  homingPigeon,
  lastEngulfing,
  beltHold,
  window,
  highWave,
];
