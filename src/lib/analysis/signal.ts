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
import { runAiCouncil, toAiVerdict } from "../ai/council";
import {
  detectCandlestickPatterns,
  candlestickBias,
  type CandlestickHit,
} from "./candlesticks";
import {
  zigzag,
  autoDepth,
  marketStructure,
  keyLevels,
  liquidityZones,
  fibRetracement,
  superTrend,
  type MarketStructure,
  type SuperTrend,
  type FibView,
  type Level,
} from "./structure";
import { detectChartPatterns } from "./chartPatterns";
import {
  detectInstitutional,
  institutionalBias,
  type InstitutionalSetup,
} from "./institutional";
import { scan24h, sessionBias, type Window24h } from "./window24h";

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

/**
 * Merge the three pattern layers into the single list the UI renders.
 *
 * Order matters: geometric chart patterns first (they carry measured targets),
 * then anything the legacy detector found that is not already covered, then at
 * most three candlestick formations. Names are de-duplicated so the same swing
 * is never presented — or scored — twice.
 */
function mergePatterns(
  chart: ChartPattern[],
  legacy: ChartPattern[],
  candlesticks: CandlestickHit[],
): ChartPattern[] {
  const out: ChartPattern[] = [...chart];
  const seen = new Set(out.map((p) => p.name));

  for (const p of legacy) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }
  for (const h of candlesticks.slice(0, 3)) {
    if (seen.has(h.name)) continue;
    seen.add(h.name);
    out.push({
      name: h.name,
      direction: h.direction,
      confidence: h.confidence,
      detail:
        h.detail +
        (h.barsAgo === 0 ? " (current bar)" : " (" + h.barsAgo + " bars ago)"),
    });
  }
  return out;
}

/**
 * Votes derived from the price-action layer: structure, SuperTrend, Fibonacci,
 * key levels and candlestick formations.
 *
 * Structure carries the largest weight of any single input because it answers
 * the only question that always matters — is this market making higher highs
 * or lower lows? An oscillator disagreeing with structure is usually the
 * oscillator being wrong.
 */
function structureVotes(
  structure: MarketStructure,
  st: SuperTrend | null,
  fib: FibView | null,
  levels: Level[],
  candleBias: { vote: number; weight: number; summary: string },
): Vote[] {
  const votes: Vote[] = [];

  if (structure.bias !== "range") {
    votes.push({
      label: "Market structure",
      vote: structure.bias === "bullish" ? 0.8 : -0.8,
      weight: 20,
      detail: structure.detail,
    });
  }

  if (structure.bos) {
    votes.push({
      label: "Break of structure",
      vote: structure.bos.direction === "up" ? 1 : -1,
      weight: 14,
      detail:
        "Break of structure " + structure.bos.direction + " through " +
        structure.bos.level.toPrecision(4) + " — the trend extended itself.",
    });
  }

  // A change of character is an EARLY warning, so it is weighted lower than a
  // confirmed break — it is often the first leg of a reversal, and often a trap.
  if (structure.choch) {
    votes.push({
      label: "Change of character",
      vote: structure.choch.direction === "up" ? 0.6 : -0.6,
      weight: 12,
      detail:
        "Change of character " + structure.choch.direction + " through " +
        structure.choch.level.toPrecision(4) + " — the prevailing trend was broken.",
    });
  }

  if (st) {
    votes.push({
      label: "SuperTrend",
      vote:
        st.direction === "up" ? (st.flipped ? 1 : 0.7) : st.flipped ? -1 : -0.7,
      weight: st.flipped ? 16 : 12,
      detail: st.detail,
    });
  }

  if (fib && fib.inZone) {
    votes.push({
      label: "Fibonacci",
      vote: fib.direction === "up" ? 0.5 : -0.5,
      weight: 8,
      detail: fib.detail,
    });
  }

  if (candleBias.weight > 0) {
    votes.push({
      label: "Candlesticks",
      vote: candleBias.vote,
      weight: candleBias.weight,
      detail: "Candlestick formations: " + candleBias.summary + ".",
    });
  }

  // Sitting on a level that has been respected repeatedly is real information;
  // a level touched once is not, so we require two touches.
  const nearest = levels.find(
    (l) => Math.abs(l.distancePct) < 3 && l.touches >= 2,
  );
  if (nearest) {
    votes.push({
      label: "Key level",
      vote: nearest.kind === "support" ? 0.4 : -0.4,
      weight: 8,
      detail:
        "Price is within " + Math.abs(nearest.distancePct).toFixed(1) +
        "% of " + nearest.kind + " at " + nearest.price.toPrecision(4) +
        " (" + nearest.touches + " touches).",
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

  // ── Mandatory full 24-hour session scan. ───────────────────────────────
  // No signal is emitted until the entire trailing 24 hours has been read bar
  // by bar. This is what makes signals reproducible: the input window is now a
  // fixed 24h of tape rather than whatever happened to be cached at call time.
  let session: Window24h | null = null;
  if (token.pairAddress) {
    try {
      session = await scan24h(token.pairAddress);
    } catch {
      session = null;
    }
  }

  // Analyse whichever series carries more structure. The 24h 5m series is
  // normally the richer one, and it is the same length on every run.
  let analysisCandles = candles;
  if (session && session.candles.length > candles.length) {
    analysisCandles = session.candles;
    timeframeLabel = session.candles.length >= 200 ? "5m (24h scan)" : timeframeLabel;
    attempts = [
      ...attempts,
      { label: "24h scan", count: session.candles.length },
    ];
  }

  const quality = gradeQuality(analysisCandles, timeframeLabel, attempts);
  const ind = computeIndicators(analysisCandles);

  // ── Price-action layer: swings → structure → patterns → candlesticks. ─────
  const priceNow =
    token.priceUsd ??
    (analysisCandles.length
      ? analysisCandles[analysisCandles.length - 1].close
      : 0);

  // ZigZag depth is scaled from the token's own realised volatility, so the
  // same code draws sane swings on a blue chip and on a coin moving 40% a bar.
  const rationaleExtras: string[] = [];
  const pivots = zigzag(analysisCandles, autoDepth(analysisCandles));
  const structure = marketStructure(analysisCandles, pivots);
  const levels = keyLevels(pivots, priceNow);
  const liquidity = liquidityZones(pivots, priceNow);
  const fib = fibRetracement(pivots, priceNow);
  const st = superTrend(analysisCandles);

  const chartPatterns = detectChartPatterns(analysisCandles, pivots);
  const legacyPatterns = detectPatterns(analysisCandles);
  const candleHits = detectCandlestickPatterns(analysisCandles);
  const candleBias = candlestickBias(candleHits);
  const patterns = mergePatterns(chartPatterns, legacyPatterns, candleHits);

  // Only the geometric chart patterns feed the pattern votes — candlesticks
  // get their own single aggregated vote so a cluster of five doji cannot
  // outweigh the actual trend.
  const institutional = detectInstitutional(analysisCandles, pivots, priceNow);
  const instBias = institutionalBias(institutional);

  const votes = collectVotes(token, ind, chartPatterns);
  votes.push(...structureVotes(structure, st, fib, levels, candleBias));

  // Institutional setups (Quasimodo, SR flips, stop hunts, compression,
  // three-drive) get one aggregated vote. Weighted just under raw market
  // structure: a swept level is strong evidence, but it is still a read on
  // WHY price moved rather than the direction it is actually moving.
  if (instBias.weight > 0) {
    votes.push({
      label: "Liquidity / institutional",
      vote: instBias.vote,
      weight: instBias.weight,
      detail: instBias.summary + ". " + institutional[0].detail,
    });
    for (const setup of institutional.slice(1)) {
      rationaleExtras.push(setup.detail);
    }
  }

  const rationale: string[] = votes.map((v) => v.detail);
  rationale.push(...rationaleExtras);

  // ── The 24h session vote. ──────────────────────────────────────────
  if (session) {
    const sb = sessionBias(session);
    votes.push({
      label: "24h session",
      vote: sb.vote,
      weight: sb.weight,
      detail: sb.detail,
    });
    rationale.push(sb.detail);
    rationale.push(
      "24h range " + session.low.toPrecision(4) + " – " + session.high.toPrecision(4) +
        " (price at " + (session.rangePosition * 100).toFixed(0) + "% of range, " +
        (session.vsVwapPct >= 0 ? "+" : "") + session.vsVwapPct.toFixed(1) + "% vs VWAP).",
    );
    for (const note of session.notes) rationale.push(note);
  } else {
    rationale.push(
      "No 24h candle history could be loaded — session context is missing, so confidence is reduced.",
    );
  }

  for (const zone of liquidity) rationale.push(zone.detail);

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
  // When the council is on, several models answer the SAME question in parallel
  // and their disagreement lowers confidence. If it is off, or no council member
  // answered, fall back to the single-model path rather than dropping AI input.
  let council = null;
  if (!opts.skipAi) {
    council = await runAiCouncil(token, ind, patterns, safetyScore).catch(
      () => null,
    );
  }
  const ai = council
    ? toAiVerdict(council)
    : opts.skipAi
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
    rationale.push(
      council
        ? `AI council (${council.members.length} models, ${Math.round(council.agreement * 100)}% agreement): ${ai.lean} (${ai.confidence}%).`
        : `AI lean: ${ai.lean} (${ai.confidence}%).`,
    );
    if (council?.dissent) rationale.push(council.dissent);
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

  // ── Suggested entry / invalidation from real structure. ──────────────────
  // Levels come from the price-action layer in priority order: the last swing
  // low, then a clustered support level, then the 24h session low, then the
  // Fibonacci golden pocket. Every one of those is a place real orders sit —
  // unlike a round number or a fixed percentage, which is what we used before.
  const supportCandidates: Array<{ price: number; why: string }> = [];
  const resistanceCandidates: Array<{ price: number; why: string }> = [];

  if (structure.lastLow != null && structure.lastLow < priceNow) {
    supportCandidates.push({ price: structure.lastLow, why: "last swing low" });
  }
  for (const l of levels) {
    if (l.kind === "support") {
      supportCandidates.push({
        price: l.price,
        why: l.touches + "-touch support",
      });
    } else {
      resistanceCandidates.push({
        price: l.price,
        why: l.touches + "-touch resistance",
      });
    }
  }
  if (session) {
    if (session.low < priceNow) {
      supportCandidates.push({ price: session.low, why: "24h low" });
    }
    if (session.high > priceNow) {
      resistanceCandidates.push({ price: session.high, why: "24h high" });
    }
    if (session.vwap < priceNow) {
      supportCandidates.push({ price: session.vwap, why: "session VWAP" });
    }
  }
  if (structure.lastHigh != null && structure.lastHigh > priceNow) {
    resistanceCandidates.push({
      price: structure.lastHigh,
      why: "last swing high",
    });
  }
  if (ind.support != null && ind.support < priceNow) {
    supportCandidates.push({ price: ind.support, why: "indicator support" });
  }
  if (ind.resistance != null && ind.resistance > priceNow) {
    resistanceCandidates.push({
      price: ind.resistance,
      why: "indicator resistance",
    });
  }

  // Nearest level below/above price is the one that actually governs the trade.
  supportCandidates.sort((a, b) => b.price - a.price);
  resistanceCandidates.sort((a, b) => a.price - b.price);
  const nearestSupport = supportCandidates[0] ?? null;
  const nearestResistance = resistanceCandidates[0] ?? null;

  let suggestedEntry: string | null = null;
  let invalidation: string | null = null;

  if (direction === "bullish") {
    const parts: string[] = [];
    if (fib && fib.inZone && fib.direction === "up") {
      parts.push("price is already in the 38.2–78.6% pullback zone");
    }
    if (nearestSupport) {
      parts.push(
        "prefer entries near " + nearestSupport.price.toPrecision(4) +
          " (" + nearestSupport.why + ")",
      );
    }
    if (ind.ema21 != null) {
      parts.push("or on a reclaim of EMA21 at " + ind.ema21.toPrecision(4));
    }
    if (session && session.rangePosition > 0.85) {
      parts.push(
        "do NOT chase here — price is at the top of the 24h range and risk/reward is poor",
      );
    }
    suggestedEntry = parts.length
      ? parts.join(", ") + "."
      : "No clean structural entry — wait for a pullback into a defined level.";

    if (nearestSupport) {
      invalidation =
        "Invalidate on a close below " + nearestSupport.price.toPrecision(4) +
        " (" + nearestSupport.why + ") — that breaks the structure the thesis rests on.";
    }
  } else if (direction === "bearish") {
    if (nearestResistance) {
      suggestedEntry =
        "Shorts/exits are favoured into " + nearestResistance.price.toPrecision(4) +
        " (" + nearestResistance.why + ").";
      invalidation =
        "Bearish thesis fails on a close above " +
        nearestResistance.price.toPrecision(4) + ".";
    }
  } else if (session) {
    suggestedEntry =
      "No directional edge. Range is " + session.low.toPrecision(4) + " – " +
      session.high.toPrecision(4) + "; wait for a decisive close outside it.";
  }

  const pf = (n: number): string => `$${n.toPrecision(4)}`;
  let targets: string[] = [];
  let stopLoss: string | null = null;

  if (direction === "bullish" && token.priceUsd != null) {
    const p = token.priceUsd;

    // Stop first, target second — that is the order a risk-managed trade is
    // actually built in. The stop goes just under the level that invalidates
    // the idea, never at an arbitrary percentage.
    const atrStop = ind.atr14 != null && ind.atr14 > 0 ? p - ind.atr14 * 2 : null;
    const structuralStop = nearestSupport
      ? nearestSupport.price * 0.995
      : null;

    if (structuralStop != null && atrStop != null) {
      // Use the tighter of the two, but never tighter than 1 ATR of noise.
      const chosen = Math.max(structuralStop, atrStop);
      stopLoss =
        pf(chosen) + " (" +
        (chosen === structuralStop
          ? nearestSupport!.why + ", just below the level"
          : "2 ATR volatility stop") + ")";
    } else if (structuralStop != null) {
      stopLoss = pf(structuralStop) + " (below " + nearestSupport!.why + ")";
    } else if (atrStop != null) {
      stopLoss = pf(atrStop) + " (2 ATR volatility stop)";
    } else {
      stopLoss = pf(p * 0.7) + " (-30%, no structural level available)";
    }

    // Targets: the first one is the next real level overhead, because that is
    // where the move will actually be tested. Only then do we project.
    const list: string[] = [];
    if (nearestResistance && nearestResistance.price > p * 1.01) {
      list.push(
        "T1 " + pf(nearestResistance.price) + " (" + nearestResistance.why + ")",
      );
    }
    if (ind.atr14 != null && ind.atr14 > 0) {
      if (!list.length) list.push("T1 " + pf(p + ind.atr14 * 2) + " (+2 ATR)");
      list.push("T2 " + pf(p + ind.atr14 * 4) + " (+4 ATR)");
    } else {
      list.push("T2 " + pf(p * 2) + " (2x)");
    }

    // Risk/reward, stated plainly. If the first target is closer than the stop
    // the trade is not worth taking and the signal says so.
    const stopPrice = stopLoss ? parseFloat(stopLoss.replace(/[^0-9.eE-]/g, "")) : NaN;
    const firstTargetPrice = nearestResistance?.price ?? (ind.atr14 ? p + ind.atr14 * 2 : p * 2);
    if (Number.isFinite(stopPrice) && stopPrice < p) {
      const risk = p - stopPrice;
      const reward = firstTargetPrice - p;
      if (risk > 0) {
        const rr = reward / risk;
        list.push("R:R to T1 is " + rr.toFixed(1) + ":1");
        if (rr < 1) {
          rationale.push(
            "Risk/reward to the first target is only " + rr.toFixed(1) +
              ":1 — the nearest resistance is closer than the invalidation level.",
          );
        }
      }
    }

    list.push("Runner " + pf(p * 3) + " (3x)");
    targets = list;
  } else if (direction === "bearish" && token.priceUsd != null && nearestSupport) {
    targets = [
      "Downside " + pf(nearestSupport.price) + " (" + nearestSupport.why + ")",
    ];
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
    analysis: {
      structure: structure.detail,
      institutional: institutional.map((x: InstitutionalSetup) => ({
        name: x.name,
        side: x.side,
        level: x.level,
        invalidation: x.invalidation,
        detail: x.detail,
      })),
      sequence: structure.sequence,
      superTrend: st ? st.detail : null,
      fib: fib ? fib.detail : null,
      session: session
        ? {
            hoursCovered: Number(session.hoursCovered.toFixed(1)),
            complete: session.complete,
            bars: session.candles.length,
            high: session.high,
            low: session.low,
            vwap: session.vwap,
            rangePosition: Number(session.rangePosition.toFixed(3)),
            volumeTrend: Number(session.volumeTrend.toFixed(2)),
            pressure: Number(session.pressure.toFixed(3)),
            changePct: Number(session.changePct.toFixed(2)),
          }
        : null,
      levels: levels.map((l) => ({
        price: l.price,
        kind: l.kind,
        touches: l.touches,
        distancePct: Number(l.distancePct.toFixed(2)),
      })),
      liquidity: liquidity.map((z) => ({ price: z.price, side: z.side })),
      candlesticks: candleHits.map((h) => ({
        name: h.name,
        direction: h.direction,
        barsAgo: h.barsAgo,
        detail: h.detail,
      })),
    },
    factors: votes.map((v) => ({
      label: v.label,
      points: Math.round(clamp(v.vote, -1, 1) * v.weight),
      detail: v.detail,
    })),
  };
}
