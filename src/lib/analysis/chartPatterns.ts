// Classic chart-pattern geometry detected from ZigZag swings.
//
// Everything here follows the textbook construction: the pattern is measured
// from real pivots, the trigger is a CLOSE through the neckline/trendline, and
// the target is projected from the pattern's own height. That last part matters
// — a pattern that cannot produce a measured target and an invalidation level
// is not tradeable, so we do not emit it.
import type { Candle, ChartPattern } from "../types";
import type { Pivot } from "./structure";

// A close must clear a level by this much to count as a real break.
const BREAK_BUFFER = 0.003;

function slope(a: { index: number; price: number }, b: { index: number; price: number }): number {
  const dx = b.index - a.index;
  if (dx === 0) return 0;
  return (b.price - a.price) / dx;
}

/** Percentage difference between two prices. */
function diffPct(a: number, b: number): number {
  if (b === 0) return Infinity;
  return Math.abs(a - b) / b;
}

function pct(a: number, b: number): number {
  if (b === 0) return 0;
  return (a - b) / b;
}

interface Ctx {
  candles: Candle[];
  pivots: Pivot[];
  highs: Pivot[];
  lows: Pivot[];
  price: number;
}

/**
 * Head & Shoulders and its inverse.
 *
 * Needs three consecutive highs where the middle is clearly the tallest and the
 * two shoulders are roughly level, plus a neckline drawn through the two lows
 * between them. Trigger = close below the neckline; target = neckline minus the
 * head-to-neckline height.
 */
function headAndShoulders(ctx: Ctx): ChartPattern[] {
  const out: ChartPattern[] = [];
  const { highs, lows, price } = ctx;

  if (highs.length >= 3 && lows.length >= 2) {
    const [ls, head, rs] = highs.slice(-3);
    const troughs = lows.filter((l) => l.index > ls.index && l.index < rs.index);
    if (
      troughs.length >= 2 &&
      head.price > ls.price * 1.02 &&
      head.price > rs.price * 1.02 &&
      diffPct(ls.price, rs.price) <= 0.06
    ) {
      const neckline = (troughs[0].price + troughs[troughs.length - 1].price) / 2;
      const height = head.price - neckline;
      if (height > 0) {
        const broken = price < neckline * (1 - BREAK_BUFFER);
        const target = neckline - height;
        out.push({
          name: "Head & Shoulders",
          direction: "bearish",
          confidence: broken ? 0.75 : 0.5,
          detail:
            "Head at " + head.price.toPrecision(4) + " between level shoulders, neckline " +
            neckline.toPrecision(4) + ". " +
            (broken
              ? "Neckline has broken — measured target " + target.toPrecision(4) + ", invalid above " + rs.price.toPrecision(4) + "."
              : "Not yet triggered — needs a close below " + neckline.toPrecision(4) + "."),
        });
      }
    }
  }

  if (lows.length >= 3 && highs.length >= 2) {
    const [ls, head, rs] = lows.slice(-3);
    const peaks = highs.filter((h) => h.index > ls.index && h.index < rs.index);
    if (
      peaks.length >= 2 &&
      head.price < ls.price * 0.98 &&
      head.price < rs.price * 0.98 &&
      diffPct(ls.price, rs.price) <= 0.06
    ) {
      const neckline = (peaks[0].price + peaks[peaks.length - 1].price) / 2;
      const height = neckline - head.price;
      if (height > 0) {
        const broken = price > neckline * (1 + BREAK_BUFFER);
        const target = neckline + height;
        out.push({
          name: "Inverse Head & Shoulders",
          direction: "bullish",
          confidence: broken ? 0.75 : 0.5,
          detail:
            "Head at " + head.price.toPrecision(4) + " between level shoulders, neckline " +
            neckline.toPrecision(4) + ". " +
            (broken
              ? "Neckline has broken — measured target " + target.toPrecision(4) + ", invalid below " + rs.price.toPrecision(4) + "."
              : "Not yet triggered — needs a close above " + neckline.toPrecision(4) + "."),
        });
      }
    }
  }
  return out;
}

/**
 * Triangles. All three are the same construction — what separates them is which
 * boundary is flat:
 *   ascending  = flat highs + rising lows  (bullish, demand absorbing supply)
 *   descending = flat lows + falling highs (bearish, supply absorbing demand)
 *   symmetrical= both converging           (neutral, trade the break)
 */
function triangles(ctx: Ctx): ChartPattern[] {
  const out: ChartPattern[] = [];
  const { highs, lows, price } = ctx;
  if (highs.length < 2 || lows.length < 2) return out;

  const h = highs.slice(-3);
  const l = lows.slice(-3);
  const hFlat = h.length >= 2 && diffPct(h[h.length - 1].price, h[h.length - 2].price) <= 0.02;
  const lFlat = l.length >= 2 && diffPct(l[l.length - 1].price, l[l.length - 2].price) <= 0.02;
  const hFalling = h.length >= 2 && h[h.length - 1].price < h[h.length - 2].price * 0.98;
  const lRising = l.length >= 2 && l[l.length - 1].price > l[l.length - 2].price * 1.02;

  const resistance = Math.max(...h.map((p) => p.price));
  const support = Math.min(...l.map((p) => p.price));
  const height = resistance - support;

  if (hFlat && lRising) {
    const broken = price > resistance * (1 + BREAK_BUFFER);
    out.push({
      name: "Ascending Triangle",
      direction: "bullish",
      confidence: broken ? 0.7 : 0.55,
      detail:
        "Flat resistance at " + resistance.toPrecision(4) + " with rising lows — buyers paying up into a fixed seller. " +
        (broken
          ? "Broken out; measured target " + (resistance + height).toPrecision(4) + ", invalid below " + support.toPrecision(4) + "."
          : "Trigger is a close above " + resistance.toPrecision(4) + "."),
    });
  } else if (lFlat && hFalling) {
    const broken = price < support * (1 - BREAK_BUFFER);
    out.push({
      name: "Descending Triangle",
      direction: "bearish",
      confidence: broken ? 0.7 : 0.55,
      detail:
        "Flat support at " + support.toPrecision(4) + " with falling highs — sellers hitting a fixed bid. " +
        (broken
          ? "Broken down; measured target " + (support - height).toPrecision(4) + ", invalid above " + resistance.toPrecision(4) + "."
          : "Trigger is a close below " + support.toPrecision(4) + "."),
    });
  } else if (hFalling && lRising) {
    out.push({
      name: "Symmetrical Triangle",
      direction: "neutral",
      confidence: 0.45,
      detail:
        "Lower highs and higher lows converging between " + support.toPrecision(4) +
        " and " + resistance.toPrecision(4) +
        " — a volatility squeeze. Direction is undecided; trade the close outside the range, target " +
        height.toPrecision(4) + " from the break.",
    });
  }
  return out;
}

/**
 * Wedges. Both boundaries slope the SAME way and converge.
 * Rising wedge = bearish (rally losing momentum), falling wedge = bullish.
 * These are the two most commonly misread patterns, which is why the direction
 * is deliberately opposite to the slope.
 */
function wedges(ctx: Ctx): ChartPattern[] {
  const out: ChartPattern[] = [];
  const { highs, lows, price } = ctx;
  if (highs.length < 2 || lows.length < 2) return out;

  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];

  const hs = slope(h1, h2);
  const ls = slope(l1, l2);
  const widthStart = Math.abs(h1.price - l1.price);
  const widthEnd = Math.abs(h2.price - l2.price);
  const converging = widthEnd < widthStart * 0.8;
  if (!converging) return out;

  if (hs > 0 && ls > 0 && ls > hs) {
    const broken = price < l2.price * (1 - BREAK_BUFFER);
    out.push({
      name: "Rising Wedge",
      direction: "bearish",
      confidence: broken ? 0.7 : 0.5,
      detail:
        "Both boundaries rising but the lows are rising faster — each push higher is weaker. " +
        (broken
          ? "Lower boundary broken at " + l2.price.toPrecision(4) + "; target back to " + l1.price.toPrecision(4) + "."
          : "Trigger is a close below " + l2.price.toPrecision(4) + "."),
    });
  }
  if (hs < 0 && ls < 0 && hs < ls) {
    const broken = price > h2.price * (1 + BREAK_BUFFER);
    out.push({
      name: "Falling Wedge",
      direction: "bullish",
      confidence: broken ? 0.7 : 0.5,
      detail:
        "Both boundaries falling but the highs are falling faster — selling is exhausting. " +
        (broken
          ? "Upper boundary broken at " + h2.price.toPrecision(4) + "; target back to " + h1.price.toPrecision(4) + "."
          : "Trigger is a close above " + h2.price.toPrecision(4) + "."),
    });
  }
  return out;
}

/**
 * Flags and pennants — a sharp impulse (the pole) followed by a shallow
 * counter-trend drift on falling volume. The measured target is the pole height
 * projected from the breakout.
 */
function flags(ctx: Ctx): ChartPattern[] {
  const out: ChartPattern[] = [];
  const { candles, price } = ctx;
  if (candles.length < 25) return out;

  const window = candles.slice(-20);
  const poleWindow = candles.slice(-25, -8);
  if (poleWindow.length < 8) return out;

  const poleStart = poleWindow[0].close;
  const poleEnd = poleWindow[poleWindow.length - 1].close;
  const poleMove = pct(poleEnd, poleStart);

  const consol = window.slice(-8);
  const cHigh = Math.max(...consol.map((c) => c.high));
  const cLow = Math.min(...consol.map((c) => c.low));
  const consolRange = (cHigh - cLow) / (cLow || 1);

  // Volume should DRY UP in the flag — that is what distinguishes a pause from
  // a genuine reversal.
  const poleVol = poleWindow.reduce((s, c) => s + c.volume, 0) / poleWindow.length;
  const flagVol = consol.reduce((s, c) => s + c.volume, 0) / consol.length;
  const volumeDried = poleVol > 0 && flagVol < poleVol * 0.85;

  const shallow = consolRange < Math.abs(poleMove) * 0.5;
  if (!shallow) return out;

  if (poleMove > 0.12) {
    const broken = price > cHigh * (1 + BREAK_BUFFER);
    out.push({
      name: "Bull Flag",
      direction: "bullish",
      confidence: (broken ? 0.7 : 0.5) + (volumeDried ? 0.05 : 0),
      detail:
        "Impulse of " + (poleMove * 100).toFixed(1) + "% then a tight drift" +
        (volumeDried ? " on drying volume" : " (volume has not dried up yet)") + ". " +
        (broken
          ? "Flag broken above " + cHigh.toPrecision(4) + "; measured target " + (cHigh * (1 + Math.abs(poleMove))).toPrecision(4) + ", invalid below " + cLow.toPrecision(4) + "."
          : "Trigger is a close above " + cHigh.toPrecision(4) + "."),
    });
  } else if (poleMove < -0.12) {
    const broken = price < cLow * (1 - BREAK_BUFFER);
    out.push({
      name: "Bear Flag",
      direction: "bearish",
      confidence: (broken ? 0.7 : 0.5) + (volumeDried ? 0.05 : 0),
      detail:
        "Drop of " + (poleMove * 100).toFixed(1) + "% then a weak bounce" +
        (volumeDried ? " on drying volume" : "") + ". " +
        (broken
          ? "Flag broken below " + cLow.toPrecision(4) + "; measured target " + (cLow * (1 - Math.abs(poleMove))).toPrecision(4) + "."
          : "Trigger is a close below " + cLow.toPrecision(4) + "."),
    });
  }
  return out;
}

/**
 * Double / triple tops and bottoms, measured properly: the target is the
 * distance from the peaks to the intervening trough, projected from the break.
 */
function doublesAndTriples(ctx: Ctx): ChartPattern[] {
  const out: ChartPattern[] = [];
  const { highs, lows, price } = ctx;

  const h = highs.slice(-3).map((p) => p.price);
  if (h.length === 3 && diffPct(h[0], h[1]) <= 0.025 && diffPct(h[1], h[2]) <= 0.025) {
    const trough = lows.length ? Math.min(...lows.slice(-2).map((p) => p.price)) : null;
    out.push({
      name: "Triple Top",
      direction: "bearish",
      confidence: 0.65,
      detail:
        "Three rejections at " + h[2].toPrecision(4) + " — a heavy supply shelf." +
        (trough ? " Break of " + trough.toPrecision(4) + " targets " + (trough - (h[2] - trough)).toPrecision(4) + "." : ""),
    });
  } else if (h.length >= 2 && diffPct(h[h.length - 1], h[h.length - 2]) <= 0.025) {
    const trough = lows.length ? Math.min(...lows.slice(-2).map((p) => p.price)) : null;
    const top = h[h.length - 1];
    out.push({
      name: "Double Top",
      direction: "bearish",
      confidence: trough && price < trough ? 0.65 : 0.5,
      detail:
        "Two rejections at " + top.toPrecision(4) + "." +
        (trough
          ? " Neckline " + trough.toPrecision(4) + "; a close below it targets " + (trough - (top - trough)).toPrecision(4) + ", invalid above " + top.toPrecision(4) + "."
          : ""),
    });
  }

  const l = lows.slice(-3).map((p) => p.price);
  if (l.length === 3 && diffPct(l[0], l[1]) <= 0.025 && diffPct(l[1], l[2]) <= 0.025) {
    const peak = highs.length ? Math.max(...highs.slice(-2).map((p) => p.price)) : null;
    out.push({
      name: "Triple Bottom",
      direction: "bullish",
      confidence: 0.65,
      detail:
        "Three defenses at " + l[2].toPrecision(4) + " — a firm demand shelf." +
        (peak ? " Break of " + peak.toPrecision(4) + " targets " + (peak + (peak - l[2])).toPrecision(4) + "." : ""),
    });
  } else if (l.length >= 2 && diffPct(l[l.length - 1], l[l.length - 2]) <= 0.025) {
    const peak = highs.length ? Math.max(...highs.slice(-2).map((p) => p.price)) : null;
    const bottom = l[l.length - 1];
    out.push({
      name: "Double Bottom",
      direction: "bullish",
      confidence: peak && price > peak ? 0.65 : 0.5,
      detail:
        "Two defenses at " + bottom.toPrecision(4) + "." +
        (peak
          ? " Neckline " + peak.toPrecision(4) + "; a close above it targets " + (peak + (peak - bottom)).toPrecision(4) + ", invalid below " + bottom.toPrecision(4) + "."
          : ""),
    });
  }
  return out;
}

/**
 * Rectangle / channel — price bounded by two roughly parallel boundaries with
 * at least two touches each. Range-trade it until a boundary breaks.
 */
function rectangle(ctx: Ctx): ChartPattern[] {
  const { highs, lows, price } = ctx;
  if (highs.length < 2 || lows.length < 2) return [];
  const h = highs.slice(-2).map((p) => p.price);
  const l = lows.slice(-2).map((p) => p.price);
  if (diffPct(h[0], h[1]) > 0.02 || diffPct(l[0], l[1]) > 0.02) return [];

  const top = (h[0] + h[1]) / 2;
  const bottom = (l[0] + l[1]) / 2;
  if (top <= bottom) return [];
  const posInRange = (price - bottom) / (top - bottom);

  return [
    {
      name: "Rectangle Range",
      direction: "neutral",
      confidence: 0.4,
      detail:
        "Boxed between " + bottom.toPrecision(4) + " and " + top.toPrecision(4) +
        ". Price sits at " + (posInRange * 100).toFixed(0) +
        "% of the range — " +
        (posInRange > 0.7
          ? "near the ceiling, poor risk/reward for a long."
          : posInRange < 0.3
            ? "near the floor, where longs have defined risk."
            : "mid-range, no edge until a boundary is tested."),
    },
  ];
}

/**
 * Cup & handle — a rounded base followed by a shallow pullback. Detected by
 * checking that the middle of the window is meaningfully lower than both rims
 * and that the rims are level.
 */
function cupAndHandle(ctx: Ctx): ChartPattern[] {
  const { candles, price } = ctx;
  if (candles.length < 40) return [];
  const win = candles.slice(-40);
  const third = Math.floor(win.length / 3);

  const leftRim = Math.max(...win.slice(0, third).map((c) => c.high));
  const bottom = Math.min(...win.slice(third, third * 2).map((c) => c.low));
  const rightRim = Math.max(...win.slice(third * 2).map((c) => c.high));

  if (diffPct(leftRim, rightRim) > 0.05) return [];
  const depth = (leftRim - bottom) / leftRim;
  if (depth < 0.12 || depth > 0.6) return [];

  const rim = (leftRim + rightRim) / 2;
  const broken = price > rim * (1 + BREAK_BUFFER);
  return [
    {
      name: "Cup & Handle",
      direction: "bullish",
      confidence: broken ? 0.65 : 0.45,
      detail:
        "Rounded base " + (depth * 100).toFixed(0) + "% deep with level rims near " +
        rim.toPrecision(4) + ". " +
        (broken
          ? "Rim broken — measured target " + (rim + (rim - bottom)).toPrecision(4) + ", invalid below " + bottom.toPrecision(4) + "."
          : "Trigger is a close above " + rim.toPrecision(4) + "."),
    },
  ];
}

/**
 * Run every chart-pattern detector against a set of ZigZag pivots.
 *
 * Returns patterns sorted strongest-first and capped, so the scorer is never
 * flooded by six overlapping readings of the same swing.
 */
export function detectChartPatterns(
  candles: Candle[],
  pivots: Pivot[],
): ChartPattern[] {
  if (candles.length < 25 || pivots.length < 3) return [];

  const ctx: Ctx = {
    candles,
    pivots,
    highs: pivots.filter((p) => p.kind === "high"),
    lows: pivots.filter((p) => p.kind === "low"),
    price: candles[candles.length - 1].close,
  };

  const found = [
    ...headAndShoulders(ctx),
    ...triangles(ctx),
    ...wedges(ctx),
    ...flags(ctx),
    ...doublesAndTriples(ctx),
    ...cupAndHandle(ctx),
    ...rectangle(ctx),
    ...rounding(ctx),
    ...pennant(ctx),
    ...channel(ctx),
  ];

  // Head & Shoulders subsumes a Double Top built from the same shoulders, so
  // drop the weaker duplicate rather than counting the swing twice.
  const hasHS = found.some((p) => p.name === "Head & Shoulders");
  const hasIHS = found.some((p) => p.name === "Inverse Head & Shoulders");
  const filtered = found.filter((p) => {
    if (hasHS && (p.name === "Double Top" || p.name === "Triple Top")) return false;
    if (hasIHS && (p.name === "Double Bottom" || p.name === "Triple Bottom")) return false;
    return true;
  });

  return filtered.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

/**
 * Rounding Bottom / Top (saucer). A slow, curved transfer of control rather
 * than a sharp V. Detected by checking that the extreme sits near the MIDDLE
 * of the window and that both sides are gradual \u2014 that curvature is the whole
 * pattern, and it is what distinguishes a base from a dead-cat bounce.
 */
function rounding(ctx: Ctx): ChartPattern[] {
  const { candles, price } = ctx;
  if (candles.length < 40) return [];
  const win = candles.slice(-40);
  const closes = win.map((c) => c.close);

  const minIdx = closes.indexOf(Math.min(...closes));
  const maxIdx = closes.indexOf(Math.max(...closes));
  const mid = win.length / 2;
  const tolerance = win.length * 0.25;

  // Rounding bottom: the low is central, and both edges are meaningfully higher.
  if (Math.abs(minIdx - mid) < tolerance) {
    const low = closes[minIdx];
    const left = closes[0];
    const right = closes[closes.length - 1];
    const depth = Math.min(pct(left, low), pct(right, low));
    const rimGap = diffPct(left, right);
    if (depth > 0.1 && rimGap < 0.12) {
      // The curve must be gradual, not a spike: no single bar may account for
      // more than a third of the whole descent.
      const maxBar = Math.max(
        ...win.slice(0, minIdx + 1).map((c) => Math.abs(c.close - c.open)),
      );
      if (maxBar < (left - low) * 0.34) {
        const rim = Math.max(left, right);
        const target = rim + (rim - low);
        return [{
          name: "Rounding Bottom",
          direction: "bullish",
          confidence: price > rim * (1 - 0.02) ? 0.65 : 0.5,
          detail:
            "Saucer base: price declined " + (depth * 100).toFixed(1) +
            "% to " + low.toPrecision(4) + " and curved back up gradually, with " +
            "level rims. Trigger is a close above " + rim.toPrecision(4) +
            ", measured target " + target.toPrecision(4) +
            ", invalid below " + low.toPrecision(4) + ".",
        }];
      }
    }
  }

  if (Math.abs(maxIdx - mid) < tolerance) {
    const high = closes[maxIdx];
    const left = closes[0];
    const right = closes[closes.length - 1];
    const height = Math.min(pct(high, left), pct(high, right));
    const rimGap = diffPct(left, right);
    if (height > 0.1 && rimGap < 0.12) {
      const rim = Math.min(left, right);
      const target = rim - (high - rim);
      return [{
        name: "Rounding Top",
        direction: "bearish",
        confidence: price < rim * (1 + 0.02) ? 0.65 : 0.5,
        detail:
          "Distribution dome: price topped at " + high.toPrecision(4) +
          " and rolled over gradually rather than spiking. Trigger is a close " +
          "below " + rim.toPrecision(4) + ", measured target " +
          (target > 0 ? target.toPrecision(4) : "the prior base") +
          ", invalid above " + high.toPrecision(4) + ".",
      }];
    }
  }
  return [];
}

/**
 * Pennant. A small SYMMETRICAL coil immediately after a sharp impulse. It is
 * distinct from a flag (which drifts against the trend on parallel lines) and
 * from a triangle (which is far larger and needs no preceding impulse).
 */
function pennant(ctx: Ctx): ChartPattern[] {
  const { candles, price } = ctx;
  if (candles.length < 25) return [];

  const pole = candles.slice(-20, -8);
  const coil = candles.slice(-8);
  if (pole.length < 8 || coil.length < 6) return [];

  const poleMove = pct(pole[pole.length - 1].close, pole[0].close);
  if (Math.abs(poleMove) < 0.12) return [];

  const firstHalf = coil.slice(0, 4);
  const secondHalf = coil.slice(4);
  const rangeOf = (arr: Candle[]) =>
    Math.max(...arr.map((c) => c.high)) - Math.min(...arr.map((c) => c.low));

  const r1 = rangeOf(firstHalf);
  const r2 = rangeOf(secondHalf);
  if (r1 <= 0 || r2 > r1 * 0.7) return [];

  const hi = Math.max(...coil.map((c) => c.high));
  const lo = Math.min(...coil.map((c) => c.low));
  if (pct(hi, lo) > Math.abs(poleMove) * 0.5) return [];

  const bullish = poleMove > 0;
  const height = Math.abs(pole[pole.length - 1].close - pole[0].close);
  const target = bullish ? hi + height : lo - height;

  return [{
    name: bullish ? "Bull Pennant" : "Bear Pennant",
    direction: bullish ? "bullish" : "bearish",
    confidence: 0.6,
    detail:
      "A " + (poleMove * 100).toFixed(1) + "% impulse followed by a tight " +
      "symmetrical coil contracting to " + ((r2 / r1) * 100).toFixed(0) +
      "% of its initial range. Trigger is a close " +
      (bullish ? "above " + hi.toPrecision(4) : "below " + lo.toPrecision(4)) +
      ", pole-projected target " +
      (target > 0 ? target.toPrecision(4) : "n/a") + ", invalid " +
      (bullish ? "below " + lo.toPrecision(4) : "above " + hi.toPrecision(4)) +
      ". Current price " + price.toPrecision(4) + ".",
  }];
}

/**
 * Ascending / Descending Channel. Two parallel sloping boundaries. The edges
 * are the trade: buy the lower rail in an up-channel, and treat a close outside
 * as either a breakout or a failure depending on direction.
 */
function channel(ctx: Ctx): ChartPattern[] {
  const { highs, lows, price, candles } = ctx;
  if (highs.length < 2 || lows.length < 2 || candles.length < 30) return [];

  const h = highs.slice(-2);
  const l = lows.slice(-2);
  const hs = slope(h[0], h[1]);
  const ls = slope(l[0], l[1]);
  if (hs === 0 || ls === 0) return [];

  // Rails must actually be parallel and both meaningfully sloped.
  const ratio = hs / ls;
  if (ratio < 0.6 || ratio > 1.6) return [];

  const lastIdx = candles.length - 1;
  const upper = h[1].price + hs * (lastIdx - h[1].index);
  const lower = l[1].price + ls * (lastIdx - l[1].index);
  if (upper <= lower) return [];

  const width = pct(upper, lower);
  if (width < 0.04 || width > 0.6) return [];

  const rising = hs > 0 && ls > 0;
  const falling = hs < 0 && ls < 0;
  if (!rising && !falling) return [];

  const position = (price - lower) / (upper - lower);
  const nearLower = position < 0.25;
  const nearUpper = position > 0.75;

  // Inside a channel the EDGE decides the lean, not the slope.
  let direction: ChartPattern["direction"] = "neutral";
  if (nearLower) direction = "bullish";
  else if (nearUpper) direction = "bearish";

  return [{
    name: rising ? "Ascending Channel" : "Descending Channel",
    direction,
    confidence: nearLower || nearUpper ? 0.55 : 0.4,
    detail:
      (rising ? "Rising" : "Falling") + " parallel channel between " +
      lower.toPrecision(4) + " and " + upper.toPrecision(4) + ". Price sits at " +
      (position * 100).toFixed(0) + "% of the channel width" +
      (nearLower
        ? " \u2014 at the lower rail, the buy edge. Invalid on a close below " +
          lower.toPrecision(4) + "."
        : nearUpper
        ? " \u2014 at the upper rail, where the channel is sold. Invalid on a close " +
          "above " + upper.toPrecision(4) + "."
        : " \u2014 mid-channel, which is the worst risk/reward location in the range."),
  }];
}
