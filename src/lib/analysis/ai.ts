// Optional AI analysis via Google Gemini (admin-toggled, needs a key).
// The model is given REAL data (token stats + indicators + patterns + safety)
// and asked for a structured opinion. This is a *lean*, never a guarantee.
import { GEMINI_API_BASE } from "../config";
import { getAdminConfig } from "../adminConfig";
import { fetchJson } from "../http";
import type {
  AiVerdict,
  ChartPattern,
  Indicators,
  TokenSummary,
} from "../types";

const MODEL = "gemini-1.5-flash";

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export function isAiAvailable(cfg: {
  aiEnabled: boolean;
  geminiApiKey: string;
}): boolean {
  return Boolean(cfg.aiEnabled && cfg.geminiApiKey);
}

function buildPrompt(
  token: TokenSummary,
  ind: Indicators,
  patterns: ChartPattern[],
  safetyScore: number | null,
): string {
  return [
    "You are a Solana memecoin trading analyst. Be blunt and risk-aware.",
    "Given the REAL data below, give a short directional lean for the next few hours.",
    "You cannot predict the future; express uncertainty honestly.",
    "",
    `Token: ${token.symbol} (${token.name})`,
    `Price: ${token.priceUsd}  1h: ${token.priceChange1h}%  24h: ${token.priceChange24h}%`,
    `Liquidity: $${token.liquidityUsd}  Vol24h: $${token.volume24h}  MCap: $${token.marketCap ?? token.fdv}`,
    `Buys/Sells 24h: ${token.txns24hBuys}/${token.txns24hSells}  Age(h): ${token.ageHours}`,
    `Indicators: trend=${ind.trend} rsi=${ind.rsi14} macdHist=${ind.macdHist} ema9=${ind.ema9} ema21=${ind.ema21} ema50=${ind.ema50}`,
    `Support=${ind.support} Resistance=${ind.resistance}`,
    `Patterns: ${patterns.map((p) => `${p.name}(${p.direction})`).join(", ") || "none"}`,
    `Safety score (0-100, higher=safer): ${safetyScore ?? "unknown"}`,
    "",
    "Respond with STRICT JSON only, no markdown, in this exact shape:",
    '{"lean":"bullish|bearish|neutral","confidence":0-100,"reasoning":"1-3 sentences","entryZone":"text or null","invalidation":"text or null","targets":["text"]}',
  ].join("\n");
}

function safeParse(text: string): Partial<AiVerdict> | null {
  // Strip code fences if the model added them.
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function analyzeWithAi(
  token: TokenSummary,
  ind: Indicators,
  patterns: ChartPattern[],
  safetyScore: number | null,
): Promise<AiVerdict | null> {
  const cfg = await getAdminConfig();
  if (!isAiAvailable(cfg)) return null;

  const url = `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${cfg.geminiApiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildPrompt(token, ind, patterns, safetyScore) }],
      },
    ],
    generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
  };

  try {
    const res = await fetchJson<GeminiResponse>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 20_000,
    });
    const text = res.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = safeParse(text);
    if (!parsed) return null;
    const lean =
      parsed.lean === "bullish" || parsed.lean === "bearish"
        ? parsed.lean
        : "neutral";
    return {
      lean,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence ?? 0))),
      reasoning: String(parsed.reasoning ?? "").slice(0, 600),
      entryZone: parsed.entryZone ? String(parsed.entryZone) : null,
      invalidation: parsed.invalidation ? String(parsed.invalidation) : null,
      targets: Array.isArray(parsed.targets)
        ? parsed.targets.map(String).slice(0, 4)
        : [],
      model: MODEL,
    };
  } catch {
    return null;
  }
}
