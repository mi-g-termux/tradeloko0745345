// Institutional price-action setups: Quasimodo (QM) levels, SR flips, stop
// hunts, compression and three-drive exhaustion.
//
// The unifying idea behind this whole family is LIQUIDITY. Large orders cannot
// be filled where there are no counterparties, so price is repeatedly driven
// into the obvious places where retail stops rest \u2014 just beyond a prior high or
// low \u2014 to harvest them, and then reverses. Every setup below is a different
// expression of that one mechanic:
//
//   \u2022 QM        \u2014 a failed higher high whose left shoulder becomes the entry
//   \u2022 SR flip   \u2014 broken resistance defended as support (or the reverse)
//   \u2022 Stop hunt \u2014 a wick through a level that closes back inside
//   \u2022 Compression\u2014 shrinking ranges coiling into a level before expansion
//   \u2022 3 Drive   \u2014 three exhausting pushes into the same direction
//
// A break is only a break on a CLOSE beyond the level. A wick through and back
// is the opposite of a break: it is the sweep that precedes the reversal.
import type { Candle } from "../types";
import type { Pivot } from "./structure";

/** A close must clear a level by this much to count as a real break. */
const BREAK_BUFFER = 0.003;

export type SetupSide = "bullish" | "bearish";

export interface InstitutionalSetup {
  name: string;
  side: SetupSide;
  /** 0..1 geometric quality, not a probability of profit. */
  confidence: number;
  /** The price the setup is traded from, when it has one. */
  level: number | null;
  /** Where the idea is objectively wrong. */
  invalidation: number | null;
  detail: string;
}

const pct = (a: number, b: number) => (b === 0 ? 0 : (a - b) / Math.abs(b));
const fmt = (n: number) => n.toPrecision(4);

/**
 * Quasimodo / Over-and-Under.
 *
 * Bearish shape, reading left to right: a high, a low, a HIGHER high (which
 * takes out buy-side liquidity), then a low that breaks BELOW the previous low.
 * That last break is the tell: the higher high was a liquidity grab, not real
 * demand. The entry (QML) is the LEFT SHOULDER high, because that is the level
 * price must retrace to in order to fill the remaining institutional orders.
 */
function quasimodo(
  pivots: Pivot[],
  candles: Candle[],
  price: number,
): InstitutionalSetup[] {
  const out: InstitutionalSetup[] = [];
  if (pivots.length < 5) return out;

  const p = pivots.slice(-6);
  for (let i = 0; i + 4 < p.length; i++) {
    const [a, b, c, d, e] = [p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4]];

    // Bearish QM: high, low, higher-high, low breaking the first low.
    if (
      a.kind === "high" && b.kind === "low" && c.kind === "high" &&
      d.kind === "low" && c.price > a.price && d.price < b.price
    ) {
      const qml = a.price;
      const swept = pct(c.price, a.price);
      const barsSince = candles.length - 1 - d.index;
      const distance = pct(price, qml);

      // How price is behaving relative to the QML decides which variant it is.
      let name = "Quasimodo (bearish)";
      let confidence = 0.6;
      let note =
        "Price has not yet returned to the level; the setup is pending.";
      if (Math.abs(distance) < 0.02) {
        name = barsSince <= 6 ? "QM Quick Retest (bearish)" : "QM Late Retest (bearish)";
        confidence = barsSince <= 6 ? 0.75 : 0.65;
        note =
          "Price is retesting the left-shoulder level now \u2014 this is where the " +
          "setup actually triggers.";
      } else if (price > qml * (1 + BREAK_BUFFER)) {
        name = "Ignored QM (bearish)";
        confidence = 0.3;
        note =
          "Price closed back above the level instead of respecting it. An ignored " +
          "QM often becomes a continuation LONG signal \u2014 do not keep shorting it.";
      } else if (distance < -0.08) {
        name = "QM in motion (bearish)";
        confidence = 0.45;
        note =
          "The move already ran well below the level. Chasing here has poor " +
          "risk/reward; wait for a retrace.";
      }

      out.push({
        name,
        side: name.startsWith("Ignored") ? "bullish" : "bearish",
        confidence,
        level: qml,
        invalidation: c.price,
        detail:
          "Higher high at " + fmt(c.price) + " (+" + (swept * 100).toFixed(1) +
          "% above the prior high) was followed by a break below " + fmt(b.price) +
          ". That marks the high as a liquidity grab. Level " + fmt(qml) +
          ", invalid above " + fmt(c.price) + ". " + note,
      });
    }

    // Bullish QM: the exact mirror.
    if (
      a.kind === "low" && b.kind === "high" && c.kind === "low" &&
      d.kind === "high" && c.price < a.price && d.price > b.price
    ) {
      const qml = a.price;
      const barsSince = candles.length - 1 - d.index;
      const distance = pct(price, qml);

      let name = "Quasimodo (bullish)";
      let confidence = 0.6;
      let note = "Price has not yet returned to the level; the setup is pending.";
      if (Math.abs(distance) < 0.02) {
        name = barsSince <= 6 ? "QM Quick Retest (bullish)" : "QM Late Retest (bullish)";
        confidence = barsSince <= 6 ? 0.75 : 0.65;
        note = "Price is retesting the left-shoulder level now \u2014 the trigger zone.";
      } else if (price < qml * (1 - BREAK_BUFFER)) {
        name = "Ignored QM (bullish)";
        confidence = 0.3;
        note =
          "Price closed back below the level instead of holding it. An ignored QM " +
          "frequently flips into continuation DOWN \u2014 stop buying it.";
      } else if (distance > 0.08) {
        name = "QM in motion (bullish)";
        confidence = 0.45;
        note = "The move already extended well above the level. Poor entry here.";
      }

      out.push({
        name,
        side: name.startsWith("Ignored") ? "bearish" : "bullish",
        confidence,
        level: qml,
        invalidation: c.price,
        detail:
          "Lower low at " + fmt(c.price) + " was followed by a break above " +
          fmt(b.price) + ", marking the low as a stop raid rather than real supply. " +
          "Level " + fmt(qml) + ", invalid below " + fmt(c.price) + ". " + note,
      });
    }
  }
  return out;
}

/**
 * SR Flip. Once a level breaks on a close, the traders who defended it are
 * trapped and must exit at their entry \u2014 which is exactly why old resistance
 * becomes new support. The retest, not the break, is the tradeable event.
 */
function srFlip(
  pivots: Pivot[],
  candles: Candle[],
  price: number,
): InstitutionalSetup[] {
  const out: InstitutionalSetup[] = [];
  if (candles.length < 12 || pivots.length < 3) return out;

  const recent = pivots.slice(-6, -1);
  for (const piv of recent) {
    const after = candles.slice(piv.index + 1);
    if (after.length < 3) continue;

    if (piv.kind === "high") {
      const broke = after.some((c) => c.close > piv.price * (1 + BREAK_BUFFER));
      if (!broke) continue;
      // Still above it, and currently retesting from above => support flip.
      if (price >= piv.price * (1 - 0.02) && Math.abs(pct(price, piv.price)) < 0.03) {
        out.push({
          name: "SR Flip (resistance to support)",
          side: "bullish",
          confidence: 0.6,
          level: piv.price,
          invalidation: piv.price * 0.97,
          detail:
            "Resistance at " + fmt(piv.price) + " broke on a close and price is now " +
            "retesting it from above. Trapped sellers exiting at breakeven is what " +
            "turns this level into support. A close back below voids it.",
        });
      }
    } else {
      const broke = after.some((c) => c.close < piv.price * (1 - BREAK_BUFFER));
      if (!broke) continue;
      if (price <= piv.price * (1 + 0.02) && Math.abs(pct(price, piv.price)) < 0.03) {
        out.push({
          name: "SR Flip (support to resistance)",
          side: "bearish",
          confidence: 0.6,
          level: piv.price,
          invalidation: piv.price * 1.03,
          detail:
            "Support at " + fmt(piv.price) + " broke on a close and price is now " +
            "retesting it from below. Trapped buyers selling into breakeven caps " +
            "the bounce. A close back above voids it.",
        });
      }
    }
  }
  return out;
}

/**
 * Stop hunt / liquidity sweep (the MPL idea). A wick that pierces a prior
 * extreme and then closes back inside is the single highest-quality reversal
 * tell in this family, because it proves the level was raided rather than
 * broken.
 */
function stopHunt(
  pivots: Pivot[],
  candles: Candle[],
): InstitutionalSetup[] {
  const out: InstitutionalSetup[] = [];
  if (candles.length < 10 || pivots.length < 2) return out;

  const lookback = Math.min(5, candles.length - 1);
  for (let k = 0; k < lookback; k++) {
    const idx = candles.length - 1 - k;
    const bar = candles[idx];

    for (const piv of pivots.slice(-8)) {
      if (piv.index >= idx - 1) continue;

      if (piv.kind === "high" && bar.high > piv.price && bar.close < piv.price) {
        out.push({
          name: "Sell-side stop hunt",
          side: "bearish",
          confidence: 0.7 * Math.max(0.5, 1 - k * 0.15),
          level: piv.price,
          invalidation: bar.high,
          detail:
            "Price wicked above the prior high at " + fmt(piv.price) +
            " and closed back below it" + (k ? " " + k + " bars ago" : "") +
            ". Buy stops were harvested and the breakout failed \u2014 this is a sweep, " +
            "not a break. Invalid on a close above " + fmt(bar.high) + ".",
        });
        return out;
      }
      if (piv.kind === "low" && bar.low < piv.price && bar.close > piv.price) {
        out.push({
          name: "Buy-side stop hunt",
          side: "bullish",
          confidence: 0.7 * Math.max(0.5, 1 - k * 0.15),
          level: piv.price,
          invalidation: bar.low,
          detail:
            "Price wicked below the prior low at " + fmt(piv.price) +
            " and closed back above it" + (k ? " " + k + " bars ago" : "") +
            ". Sell stops were harvested and the breakdown failed. Invalid on a " +
            "close below " + fmt(bar.low) + ".",
        });
        return out;
      }
    }
  }
  return out;
}

/**
 * Compression. Successively smaller ranges pressing into one level means one
 * side is absorbing everything the other side supplies. Direction is unknown
 * until it resolves, but the EXPANSION that follows is usually violent.
 */
function compression(candles: Candle[]): InstitutionalSetup[] {
  if (candles.length < 20) return [];
  const win = candles.slice(-12);
  const first = win.slice(0, 6);
  const second = win.slice(6);
  const avgRange = (arr: Candle[]) =>
    arr.reduce((s, c) => s + (c.high - c.low), 0) / arr.length;

  const r1 = avgRange(first);
  const r2 = avgRange(second);
  if (r1 <= 0 || r2 >= r1 * 0.6) return [];

  const hi = Math.max(...second.map((c) => c.high));
  const lo = Math.min(...second.map((c) => c.low));
  const mid = (hi + lo) / 2;
  const width = pct(hi, lo);

  return [{
    name: "Compression",
    side: candles[candles.length - 1].close > mid ? "bullish" : "bearish",
    confidence: 0.4,
    level: mid,
    invalidation: null,
    detail:
      "Bar ranges contracted to " + ((r2 / r1) * 100).toFixed(0) +
      "% of their recent average inside a " + (width * 100).toFixed(1) +
      "% band (" + fmt(lo) + "\u2013" + fmt(hi) + "). Coiling like this resolves with an " +
      "expansion \u2014 the lean is only a tiebreaker, so trade the break, not the coil.",
  }];
}

/**
 * Three Drive. Three successive pushes into the same direction, each smaller
 * than the last, is momentum exhausting rather than trend strength.
 */
function threeDrive(pivots: Pivot[]): InstitutionalSetup[] {
  if (pivots.length < 6) return [];
  const p = pivots.slice(-6);
  const highs = p.filter((x) => x.kind === "high");
  const lows = p.filter((x) => x.kind === "low");

  if (highs.length >= 3) {
    const [h1, h2, h3] = highs.slice(-3);
    if (h2.price > h1.price && h3.price > h2.price) {
      const d1 = h2.price - h1.price;
      const d2 = h3.price - h2.price;
      if (d2 < d1 * 0.7) {
        return [{
          name: "Three Drive (bearish exhaustion)",
          side: "bearish",
          confidence: 0.55,
          level: h3.price,
          invalidation: h3.price * 1.03,
          detail:
            "Three consecutive higher highs with each push " +
            ((1 - d2 / d1) * 100).toFixed(0) +
            "% smaller than the previous one. The trend is intact but running out " +
            "of fuel \u2014 tighten stops rather than adding.",
        }];
      }
    }
  }
  if (lows.length >= 3) {
    const [l1, l2, l3] = lows.slice(-3);
    if (l2.price < l1.price && l3.price < l2.price) {
      const d1 = l1.price - l2.price;
      const d2 = l2.price - l3.price;
      if (d2 < d1 * 0.7) {
        return [{
          name: "Three Drive (bullish exhaustion)",
          side: "bullish",
          confidence: 0.55,
          level: l3.price,
          invalidation: l3.price * 0.97,
          detail:
            "Three consecutive lower lows with each push shrinking. Selling is " +
            "decelerating, which typically precedes a reversal or a base.",
        }];
      }
    }
  }
  return [];
}

/** Run every institutional detector and return the strongest setups. */
export function detectInstitutional(
  candles: Candle[],
  pivots: Pivot[],
  price: number,
): InstitutionalSetup[] {
  if (candles.length < 20 || pivots.length < 3) return [];
  const all = [
    ...stopHunt(pivots, candles),
    ...quasimodo(pivots, candles, price),
    ...srFlip(pivots, candles, price),
    ...threeDrive(pivots),
    ...compression(candles),
  ];
  const seen = new Set<string>();
  const unique = all.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
  return unique.sort((a, b) => b.confidence - a.confidence).slice(0, 4);
}

/** Collapse the setups into one weighted directional vote. */
export function institutionalBias(setups: InstitutionalSetup[]): {
  vote: number;
  weight: number;
  summary: string;
} {
  if (setups.length === 0) {
    return { vote: 0, weight: 0, summary: "No institutional setups detected." };
  }
  let score = 0;
  let total = 0;
  for (const s of setups) {
    total += s.confidence;
    score += s.side === "bullish" ? s.confidence : -s.confidence;
  }
  const vote = total > 0 ? score / total : 0;
  return {
    vote: Math.max(-1, Math.min(1, vote)),
    weight: Math.min(18, total * 12),
    summary: setups.map((s) => s.name).join(", "),
  };
}
