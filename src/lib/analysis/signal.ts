// Signal engine — the memecoin equivalent of the Quotex bot's signal logic.
// It fuses REAL momentum, technicals, chart patterns, safety, X/Twitter social,
// and (optionally) the AI lean into a single directional call with a suggested
// buy zone and invalidation. This is a probabilistic signal, NOT a guaranteed
// prediction.
import type {
  ChartPattern,
  Indicators,
  SocialStats,
  TokenSummary,
  TradeSignal,
} from "../types";
import { getCandles } from "../data/candles";
import { getTokenSummary } from "../data/dexscreener";
import { analyzeSafety } from "../data/safety";
import { getSocialStats } from "../data/twitter";
import { computeIndicators, detectPatterns } from "./technical";
import { analyzeWithAi } from "./ai";

function clampScore(n: number): number {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

/** Composite technical/momentum score in -100..100. */
function scoreComposite(
  token: TokenSummary,
  ind: Indicators,
  patterns: ChartPattern[],
): { score: number; rationale: string[] } {
  let score = 0;
  const rationale: string[] = [];

  // Trend (EMA stack).
  if (ind.trend === "up") {
    score += 22;
    rationale.push("EMAs stacked bullish (9>21>50).");
  } else if (ind.trend === "down") {
    score -= 22;
    rationale.push("EMAs stacked bearish (9<21<50).");
  }

  // MACD histogram.
  if (ind.macdHist != null) {
    if (ind.macdHist > 0) {
      score += 12;
      rationale.push("MACD histogram positive (momentum up).");
    } else {
      score -= 12;
      rationale.push("MACD histogram negative (momentum down).");
    }
  }

  // RSI — reward healthy momentum, penalise overbought/oversold extremes.
  if (ind.rsi14 != null) {
    if (ind.rsi14 >= 70) {
      score -= 8;
      rationale.push(`RSI ${ind.rsi14.toFixed(0)} — overbought, chase risk.`);
    } else if (ind.rsi14 <= 30) {
      score += 6;
      rationale.push(`RSI ${ind.rsi14.toFixed(0)} — oversold bounce potential.`);
    } else if (ind.rsi14 > 50) {
      score += 8;
      rationale.push(`RSI ${ind.rsi14.toFixed(0)} — momentum favouring buyers.`);
    }
  }

  // Short-term price action.
  if (token.priceChange1h != null) {
    score += Math.max(-15, Math.min(15, token.priceChange1h * 0.5));
  }

  // Buy/sell pressure.
  const buys = token.txns24hBuys ?? 0;
  const sells = token.txns24hSells ?? 0;
  if (buys + sells > 0) {
    const ratio = (buys - sells) / (buys + sells);
    score += ratio * 12;
    rationale.push(
      `24h flow ${buys} buys / ${sells} sells (${ratio >= 0 ? "net buying" : "net selling"}).`,
    );
  }

  // Patterns.
  for (const p of patterns) {
    const w = p.confidence * 18;
    if (p.direction === "bullish") {
      score += w;
      rationale.push(`Pattern: ${p.name} (bullish).`);
    } else if (p.direction === "bearish") {
      score -= w;
      rationale.push(`Pattern: ${p.name} (bearish).`);
    } else {
      rationale.push(`Pattern: ${p.name} (neutral / breakout pending).`);
    }
  }

  return { score: clampScore(score), rationale };
}

export async function buildSignal(address: string): Promise<TradeSignal> {
  const token = await getTokenSummary(address);
  if (!token) throw new Error("Token not found on Solana DEXes.");

  // Real candles (needs a pair address). Fall back gracefully if unavailable.
  let candles = [];
  try {
    if (token.pairAddress) {
      candles = await getCandles(token.pairAddress, "hour", 1, 200);
    }
  } catch {
    candles = [];
  }

  const ind = computeIndicators(candles);
  const patterns = detectPatterns(candles);
  const { score, rationale } = scoreComposite(token, ind, patterns);

  // Safety folds in: an unsafe token caps bullishness hard.
  let safetyScore: number | null = null;
  try {
    const safety = await analyzeSafety(address);
    safetyScore = safety.score;
    if (safety.verdict === "danger") {
      rationale.push("Safety = DANGER: rug signals present, bullish score capped.");
    }
  } catch {
    safetyScore = null;
  }

  // X / Twitter social (only if admin enabled + key present).
  let social: SocialStats | null = null;
  try {
    social = await getSocialStats(token.symbol, address);
  } catch {
    social = null;
  }

  let blended = score;

  // Social contribution: buzz + sentiment, capped at +/-15.
  if (social && social.available) {
    const buzz = Math.min(1, social.mentionCount / 40); // 40+ mentions = max buzz
    const socialSigned = social.sentiment * buzz * 15;
    blended = clampScore(blended + socialSigned);
    rationale.push(
      `X: ${social.mentionCount} mentions, sentiment ${social.sentiment.toFixed(2)} (${social.sentiment >= 0 ? "net positive" : "net negative"}).`,
    );
  }

  // Optional AI lean (only if admin enabled + key present).
  const ai = await analyzeWithAi(token, ind, patterns, safetyScore).catch(
    () => null,
  );
  if (ai) {
    const aiSigned =
      ai.lean === "bullish"
        ? ai.confidence
        : ai.lean === "bearish"
          ? -ai.confidence
          : 0;
    blended = clampScore(blended * 0.75 + aiSigned * 0.25);
    rationale.push(`AI lean: ${ai.lean} (${ai.confidence}%).`);
  }

  // Hard safety cap.
  if (safetyScore != null && safetyScore < 35 && blended > 0) {
    blended = Math.round(blended * 0.3);
    rationale.push("Bullish score reduced due to low safety score.");
  }

  const direction =
    blended >= 15 ? "bullish" : blended <= -15 ? "bearish" : "neutral";
  const confidence = Math.min(100, Math.abs(blended));

  // Suggested entry / invalidation from structure.
  let suggestedEntry: string | null = null;
  let invalidation: string | null = null;
  if (direction === "bullish") {
    if (ind.support != null)
      suggestedEntry = `Prefer entries near support ${ind.support.toPrecision(4)} or on a reclaim of ${ind.ema21?.toPrecision(4) ?? "EMA21"}.`;
    if (ind.support != null)
      invalidation = `Invalidate below ${ind.support.toPrecision(4)} (structure break).`;
  } else if (direction === "bearish") {
    invalidation = ind.resistance != null
      ? `Bearish thesis fails above ${ind.resistance.toPrecision(4)}.`
      : null;
  }

  return {
    address,
    symbol: token.symbol,
    direction,
    confidence,
    score: blended,
    priceUsd: token.priceUsd,
    suggestedEntry,
    invalidation,
    rationale,
    indicators: ind,
    patterns,
    safetyScore,
    ai,
    aiEnabled: Boolean(ai),
    social,
    updatedAt: new Date().toISOString(),
  };
}
