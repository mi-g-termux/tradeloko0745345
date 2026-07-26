// Signal engine — fuses REAL momentum, technicals, chart patterns, safety,
// X/Twitter social and (optionally) an AI lean into a single directional call
// with a suggested buy zone and invalidation. Probabilistic, NOT a prediction.
//
// ── Why this file was rewritten ────────────────────────────────────────────
// The old scoring added FIXED point values to a running total and then used
// `confidence = |score|`. Two structural bugs fell out of that:
//
//  1. A token with NO chart data could still reach ±27+ from 1h price change and
//     buy/sell flow alone, so it emitted a "bullish" call with a confidence
//     number that implied chart confirmation that never happened. That is the
//     inaccuracy you were seeing.
//  2. Confidence was not normalised by how much evidence existed, so a token
//     with 2 inputs and a token with 9 inputs were scored on the same scale.
//
// Now every input contributes a WEIGHTED vote. The final score is the weighted
// average (−100..100), so it is always "of the evidence we actually have", and
// confidence is additionally scaled by data quality. Tokens without enough
// chart history are reported as `neutral` with an explicit reason instead of a
// confident-looking guess.
import type {
  Candle,
  ChartPattern,
  Indicators,
  SignalQuality,
  SocialStats,
  TokenSummary,
  TradeSignal,
} from "../types";
import { getAdaptiveCandles } from "../data/candles";
import { getTokenSummary } from "../data/dexscreener";
import { analyzeSafety } from "../data/safety";
import { getSocialStats } from "../data/twitter";
import { computeIndicators, detectPatterns, TECHNICAL_LIMITS } from "./technical";
import { analyzeWithAi } from "./ai";

/** One weighted piece of evidence. `vote` is −1..1, `weight` is its importance. */
interface Vote {
  label: string;
  vote: number;
  weight: number;
  detail: string;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Collapse weighted votes into a −100..100 score.
 * Returns the score plus the total weight so callers know how much evidence
 * actually existed.
 */
function tally(votes: Vote[]): { score: number; weight: number } {
  let weighted = 0;
  let weight = 0;
  for (const v of votes) {
    weighted += clamp(v.vote, -1, 1) * v.weight;
    weight += v.weight;
  }
  if (weight === 0) return { score: 0, weight: 0 };
  return { score: Math.round((weighted / weight) * 100), weight };
}

/** Grade how trustworthy the chart evidence is. */
function gradeQuality(
  candles: Candle[],
  timeframe: string,
  attempts: Array<{ label: string; count: number }>,
): SignalQuality {
  const n = candles.length;
  const notes: string[] = [];
  let level: SignalQuality["level"];

  if (n === 0) {
    level = "none";
    notes.push(
      "No OHLCV candles available for this pair — chart-based indicators were skipped.",
    );
  } else if (n < TECHNICAL_LIMITS.MIN_SIGNAL_CANDLES) {
    level = "low";
    notes.push(
      `Only ${n} ${timeframe} candles of history — too little for a reliable directional call.`,
    );
  } else if (n < TECHNICAL_LIMITS.MIN_PATTERN_CANDLES) {
    level = "low";
    notes.push(
      `${n} ${timeframe} candles — momentum only; chart patterns need ${TECHNICAL_LIMITS.MIN_PATTERN_CANDLES}+.`,
    );
  } else if (n < TECHNICAL_LIMITS.GOOD_SIGNAL_CANDLES) {
    level = "medium";
    notes.push(
      `${n} ${timeframe} candles — EMA50/MACD may still be warming up.`,
    );
  } else {
    level = "high";
  }

  if (attempts.length > 1) {
    notes.push(
      `Timeframes tried: ${attempts.map((a) => `${a.label}=${a.count}`).join(", ")}.`,
    );
  }
  return { candles: n, timeframe, level, notes };
}

/** Confidence multiplier derived from data quality. */
function qualityMultiplier(q: SignalQuality): number {
  switch (q.level) {
    case "high":
      return 1;
    case "medium":
      return 0.85;
    case "low":
      return 0.55;
    default:
      return 0.35;
  }
}

/** Build the weighted vote list from market data + indicators + patterns. */
function collectVotes(
  token: TokenSummary,
  ind: Indicators,
  patterns: ChartPattern[],
): Vote[] {
  const votes: Vote[] = [];
  const hasChart = (ind.candleCount ?? 0) >= TECHNICAL_LIMITS.MIN_SIGNAL_CANDLES;

  // ── Trend (EMA stack) — only when the EMAs are genuinely defined. ──
  if (hasChart && ind.trend !== "sideways") {
    const full = ind.ema50 != null; // full 9/21/50 stack vs 9/21 fallback
    votes.push({
      label: "Trend",
      vote: ind.trend === "up" ? 1 : -1,
      weight: full ? 22 : 13,
      detail:
        ind.trend === "up"
          ? full
            ? "EMAs stacked bullish (9>21>50)."
            : "EMA9 above EMA21 (short-term uptrend; EMA50 still warming up)."
          : full
            ? "EMAs stacked bearish (9<21<50)."
            : "EMA9 below EMA21 (short-term downtrend; EMA50 still warming up).",
    });
  }

  // ── MACD histogram — scaled by size relative to price, not just sign. ──
  if (ind.macdHist != null && token.priceUsd) {
    const rel = ind.macdHist / token.priceUsd; // fraction of price
    const vote = clamp(rel * 200, -1, 1);
    votes.push({
      label: "MACD",
      vote,
      weight: 14,
      detail: `MACD histogram ${ind.macdHist > 0 ? "positive" : "negative"} (momentum ${ind.macdHist > 0 ? "up" : "down"}).`,
    });
  }

  // ── RSI — reward healthy momentum, penalise stretched extremes. ──
  if (ind.rsi14 != null) {
    const r = ind.rsi14;
    let vote: number;
    let detail: string;
    if (r >= 75) {
      vote = -0.7;
      detail = `RSI ${r.toFixed(0)} — overbought, high chase risk.`;
    } else if (r >= 60) {
      vote = 0.7;
      detail = `RSI ${r.toFixed(0)} — momentum favouring buyers.`;
    } else if (r > 45) {
      vote = 0.15;
      detail = `RSI ${r.toFixed(0)} — balanced.`;
    } else if (r > 30) {
      vote = -0.35;
      detail = `RSI ${r.toFixed(0)} — momentum fading.`;
    } else {
      vote = 0.4;
      detail = `RSI ${r.toFixed(0)} — oversold bounce potential.`;
    }
    votes.push({ label: "RSI", vote, weight: 12, detail });
  }

  // ── Short-term price action (real DexScreener windows). ──
  if (token.priceChange5m != null) {
    votes.push({
      label: "5m change",
      vote: clamp(token.priceChange5m / 15, -1, 1),
      weight: 8,
      detail: `5m move ${token.priceChange5m.toFixed(1)}%.`,
    });
  }
  if (token.priceChange1h != null) {
    votes.push({
      label: "1h change",
      vote: clamp(token.priceChange1h / 30, -1, 1),
      weight: 14,
      detail: `1h move ${token.priceChange1h.toFixed(1)}%.`,
    });
  }
  if (token.priceChange6h != null) {
    votes.push({
      label: "6h change",
      vote: clamp(token.priceChange6h / 60, -1, 1),
      weight: 10,
      detail: `6h move ${token.priceChange6h.toFixed(1)}%.`,
    });
  }

  // ── Buy/sell pressure. Require a meaningful sample before trusting it. ──
  const buys = token.txns24hBuys ?? 0;
  const sells = token.txns24hSells ?? 0;
  const total = buys + sells;
  if (total >= 30) {
    const ratio = (buys - sells) / total;
    votes.push({
      label: "Order flow",
      vote: clamp(ratio * 2.5, -1, 1),
      weight: 14,
      detail: `24h flow ${buys} buys / ${sells} sells (${ratio >= 0 ? "net buying" : "net selling"}).`,
    });
  } else if (total > 0) {
    votes.push({
      label: "Order flow",
      vote: 0,
      weight: 3,
      detail: `Only ${total} tracked 24h txns — flow sample too small to weight.`,
    });
  }

  // ── Liquidity vs volume: real turnover is bullish, but thin books are risk. ──
  if (token.liquidityUsd != null && token.volume24h != null && token.liquidityUsd > 0) {
    const turnover = token.volume24h / token.liquidityUsd;
    if (token.liquidityUsd < 5_000) {
      votes.push({
        label: "Liquidity",
        vote: -0.8,
        weight: 10,
        detail: `Very thin liquidity ($${Math.round(token.liquidityUsd).toLocaleString()}) — slippage and exit risk.`,
      });
    } else if (turnover > 1) {
      votes.push({
        label: "Turnover",
        vote: clamp(turnover / 5, 0, 1),
        weight: 8,
        detail: `24h volume is ${turnover.toFixed(1)}x liquidity — active rotation.`,
      });
    }
  }

  // ── Patterns (only produced when there are 30+ candles). ──
  for (const p of patterns) {
    if (p.direction === "neutral") continue;
    votes.push({
      label: `Pattern: ${p.name}`,
      vote: p.direction === "bullish" ? p.confidence : -p.confidence,
      weight: 16,
      detail: `${p.name} (${p.direction}) — ${p.detail}`,
    });
  }

  return votes;
}

export async function buildSignal(
  address: string,
  opts: { skipAi?: boolean; skipSocial?: boolean } = {},
): Promise<TradeSignal> {
  const token = await getTokenSummary(address);
  if (!token) throw new Error("Token not found on Solana DEXes.");

  // ── Real candles at an age-appropriate timeframe. ──
  // A 40-minute-old memecoin has no hourly history, so asking for hourly bars
  // (the old behaviour) returned almost nothing. Adapt to the token's age.
  let candles: Candle[] = [];
  let timeframeLabel = "n/a";
  let attempts: Array<{ label: string; count: number }> = [];
  if (token.pairAddress) {
    try {
      const res = await getAdaptiveCandles(
        token.pairAddress,
        token.ageHours,
        TECHNICAL_LIMITS.GOOD_SIGNAL_CANDLES,
      );
      candles = res.candles;
      timeframeLabel = res.spec.label;
      attempts = res.attempts;
    } catch {
      candles = [];
    }
  }

  const quality = gradeQuality(candles, timeframeLabel, attempts);
  const ind = computeIndicators(candles);
  const patterns = detectPatterns(candles);

  const votes = collectVotes(token, ind, patterns);
  const rationale: string[] = votes.map((v) => v.detail);

  // ── Safety folds in as its own weighted vote (and a hard cap later). ──
  let safetyScore: number | null = null;
  try {
    const safety = await analyzeSafety(address);
    safetyScore = safety.score;
    votes.push({
      label: "Safety",
      // 60 is the neutral midpoint: 100 => +1, 20 => -1.
      vote: clamp((safety.score - 60) / 40, -1, 1),
      weight: safety.verdict === "danger" ? 26 : 16,
      detail: `Safety score ${safety.score}/100 (${safety.verdict}).`,
    });
    rationale.push(`Safety score ${safety.score}/100 (${safety.verdict}).`);
    if (safety.verdict === "danger") {
      rationale.push(
        "Safety = DANGER: rug signals present, bullish score capped.",
      );
    }
  } catch {
    safetyScore = null;
  }

  // ── X / Twitter social (only if admin enabled + key present). ──
  let social: SocialStats | null = null;
  if (!opts.skipSocial) {
    try {
      social = await getSocialStats(token.symbol, address);
    } catch {
      social = null;
    }
  }
  if (social?.available) {
    const buzz = Math.min(1, social.mentionCount / 40); // 40+ mentions = max buzz
    votes.push({
      label: "X sentiment",
      vote: clamp(social.sentiment, -1, 1),
      // Weight scales with buzz: 3 mentions shouldn't move the needle.
      weight: 6 + 10 * buzz,
      detail: `X: ${social.mentionCount} mentions, sentiment ${social.sentiment.toFixed(2)}.`,
    });
    rationale.push(
      `X: ${social.mentionCount} mentions, sentiment ${social.sentiment.toFixed(2)} (${social.sentiment >= 0 ? "net positive" : "net negative"}).`,
    );
  }

  // ── Optional AI lean (only if admin enabled + key present). ──
  const ai = opts.skipAi
    ? null
    : await analyzeWithAi(token, ind, patterns, safetyScore).catch(() => null);
  if (ai) {
    votes.push({
      label: "AI lean",
      vote:
        ai.lean === "bullish"
          ? ai.confidence / 100
          : ai.lean === "bearish"
            ? -ai.confidence / 100
            : 0,
      weight: 18,
      detail: `AI lean: ${ai.lean} (${ai.confidence}%).`,
    });
    rationale.push(`AI lean: ${ai.lean} (${ai.confidence}%).`);
  }

  // ── Weighted tally. ──
  const { score: rawScore, weight: evidenceWeight } = tally(votes);
  let blended = rawScore;

  // Hard safety cap: never publish a strong bullish call on a likely rug.
  if (safetyScore != null && safetyScore < 35 && blended > 0) {
    blended = Math.round(blended * 0.3);
    rationale.push("Bullish score reduced due to low safety score.");
  }

  // ── Direction + confidence. ──
  const qMul = qualityMultiplier(quality);
  let confidence = Math.round(Math.min(100, Math.abs(blended)) * qMul);

  // Thin evidence must not masquerade as conviction.
  if (evidenceWeight < 40) {
    confidence = Math.round(confidence * 0.6);
    rationale.push(
      "Confidence reduced: few independent inputs were available for this token.",
    );
  }

  let direction: TradeSignal["direction"] =
    blended >= 15 ? "bullish" : blended <= -15 ? "bearish" : "neutral";

  // The honesty gate: without enough chart history we do NOT issue a
  // directional call. This is the single biggest accuracy fix — previously
  // these tokens produced confident calls from price change + flow alone.
  if (
    candles.length < TECHNICAL_LIMITS.MIN_SIGNAL_CANDLES &&
    direction !== "neutral"
  ) {
    rationale.unshift(
      `Held at neutral: only ${candles.length} candles of price history — not enough to confirm a ${direction} setup.`,
    );
    direction = "neutral";
    confidence = Math.min(confidence, 25);
  }

  // ── Suggested entry / invalidation from real structure. ──
  let suggestedEntry: string | null = null;
  let invalidation: string | null = null;
  if (direction === "bullish") {
    if (ind.support != null) {
      suggestedEntry = `Prefer entries near support ${ind.support.toPrecision(4)} or on a reclaim of ${ind.ema21?.toPrecision(4) ?? "EMA21"}.`;
      invalidation = `Invalidate below ${ind.support.toPrecision(4)} (structure break).`;
    }
  } else if (direction === "bearish" && ind.resistance != null) {
    invalidation = `Bearish thesis fails above ${ind.resistance.toPrecision(4)}.`;
  }

  const pf = (n: number): string => `$${n.toPrecision(4)}`;
  let targets: string[] = [];
  let stopLoss: string | null = null;
  if (direction === "bullish" && token.priceUsd != null) {
    const p = token.priceUsd;
    // Prefer ATR-derived targets when volatility is measurable; fall back to
    // simple multiples for very young tokens.
    if (ind.atr14 != null && ind.atr14 > 0) {
      targets = [
        `T1 ${pf(p + ind.atr14 * 2)} (+2 ATR)`,
        `T2 ${pf(p + ind.atr14 * 4)} (+4 ATR)`,
        `Runner ${pf(p * 3)} (3x)`,
      ];
      stopLoss =
        ind.support != null
          ? `${pf(Math.max(ind.support, p - ind.atr14 * 2))} (support / 2 ATR)`
          : `${pf(p - ind.atr14 * 2)} (2 ATR)`;
    } else {
      targets = [`2x (${pf(p * 2)})`, `3x (${pf(p * 3)})`, `5x (${pf(p * 5)})`];
      stopLoss =
        ind.support != null
          ? `${pf(ind.support)} (support) / -30% (${pf(p * 0.7)})`
          : `-30% (${pf(p * 0.7)})`;
    }
  }

  return {
    address,
    symbol: token.symbol,
    direction,
    confidence,
    score: blended,
    priceUsd: token.priceUsd,
    marketCap: token.marketCap ?? token.fdv,
    suggestedEntry,
    invalidation,
    targets,
    stopLoss,
    rationale,
    indicators: ind,
    patterns,
    safetyScore,
    ai,
    aiEnabled: Boolean(ai),
    social,
    updatedAt: new Date().toISOString(),
    quality,
    factors: votes.map((v) => ({
      label: v.label,
      points: Math.round(clamp(v.vote, -1, 1) * v.weight),
      detail: v.detail,
    })),
  };
}
