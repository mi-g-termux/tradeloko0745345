// Multi-model "AI council".
//
// One model answering alone has no way to signal that it is unsure. Asking
// several independent models the SAME question and comparing answers gives a
// real uncertainty measure: when they agree the signal keeps its confidence,
// and when they split the confidence is cut. That is the whole point here --
// disagreement is surfaced, never averaged away into a confident-looking number.
//
// Every provider is optional. Whichever keys are filled in become the council;
// with a single key this behaves exactly like the old single-model path.
import { GEMINI_API_BASE } from "../config";
import { getAdminConfig } from "../adminConfig";
import { fetchJson } from "../http";
import { buildAnalystPrompt, parseVerdictJson } from "../analysis/ai";
import type {
  AiVerdict,
  ChartPattern,
  Indicators,
  TokenSummary,
} from "../types";

export type Lean = "bullish" | "bearish" | "neutral";

/** One model's independent opinion. */
export interface CouncilMember {
  provider: string;
  model: string;
  lean: Lean;
  confidence: number;
  reasoning: string;
}

export interface CouncilVerdict {
  lean: Lean;
  /** Confidence AFTER the disagreement penalty. */
  confidence: number;
  /** Confidence the majority claimed on its own, before the penalty. */
  rawConfidence: number;
  reasoning: string;
  entryZone: string | null;
  invalidation: string | null;
  targets: string[];
  model: string;
  members: CouncilMember[];
  /** Share of voters backing the winning lean, 0..1. 1 = unanimous. */
  agreement: number;
  /** Human summary of the split, shown in the UI and Telegram. */
  dissent: string | null;
}

const TIMEOUT_MS = 20_000;

function normalizeLean(v: unknown): Lean {
  return v === "bullish" || v === "bearish" ? v : "neutral";
}

function clampConfidence(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Provider adapters. Each takes the shared prompt and returns raw model text.
// Anything that throws or times out is simply dropped from the council.
// ---------------------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

async function askGemini(key: string, prompt: string): Promise<string> {
  const model = "gemini-2.0-flash";
  const res = await fetchJson<GeminiResponse>(
    GEMINI_API_BASE + "/models" + "/" + model + ":generateContent?key=" + key,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
      }),
      timeoutMs: TIMEOUT_MS,
    },
  );
  return res.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

// OpenAI, Groq and DeepSeek all speak the same /chat/completions dialect, so a
// single adapter covers three providers.
async function askOpenAiCompatible(
  baseUrl: string,
  key: string,
  model: string,
  prompt: string,
): Promise<string> {
  const res = await fetchJson<OpenAiChatResponse>(baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
    timeoutMs: TIMEOUT_MS,
  });
  return res.choices?.[0]?.message?.content ?? "";
}

interface AnthropicResponse {
  content?: Array<{ text?: string }>;
}

async function askAnthropic(key: string, prompt: string): Promise<string> {
  const res = await fetchJson<AnthropicResponse>(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 512,
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }],
      }),
      timeoutMs: TIMEOUT_MS,
    },
  );
  return res.content?.[0]?.text ?? "";
}

interface Candidate {
  provider: string;
  model: string;
  run: (prompt: string) => Promise<string>;
}

/** Build the roster from whichever keys are configured. */
function roster(cfg: {
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  groqApiKey: string;
  deepseekApiKey: string;
}): Candidate[] {
  const out: Candidate[] = [];
  const gemini = (cfg.geminiApiKey || "").trim();
  const openai = (cfg.openaiApiKey || "").trim();
  const anthropic = (cfg.anthropicApiKey || "").trim();
  const groq = (cfg.groqApiKey || "").trim();
  const deepseek = (cfg.deepseekApiKey || "").trim();

  if (gemini) {
    out.push({
      provider: "Gemini",
      model: "gemini-2.0-flash",
      run: (p) => askGemini(gemini, p),
    });
  }
  if (openai) {
    out.push({
      provider: "OpenAI",
      model: "gpt-4o-mini",
      run: (p) =>
        askOpenAiCompatible(
          "https://api.openai.com/v1",
          openai,
          "gpt-4o-mini",
          p,
        ),
    });
  }
  if (anthropic) {
    out.push({
      provider: "Anthropic",
      model: "claude-3-5-haiku-latest",
      run: (p) => askAnthropic(anthropic, p),
    });
  }
  if (groq) {
    out.push({
      provider: "Groq",
      model: "llama-3.3-70b-versatile",
      run: (p) =>
        askOpenAiCompatible(
          "https://api.groq.com/openai/v1",
          groq,
          "llama-3.3-70b-versatile",
          p,
        ),
    });
  }
  if (deepseek) {
    out.push({
      provider: "DeepSeek",
      model: "deepseek-chat",
      run: (p) =>
        askOpenAiCompatible(
          "https://api.deepseek.com/v1",
          deepseek,
          "deepseek-chat",
          p,
        ),
    });
  }
  return out;
}

/** How many providers currently have a usable key. */
export function councilSize(cfg: {
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  groqApiKey: string;
  deepseekApiKey: string;
}): number {
  return roster(cfg).length;
}

/**
 * Ask every configured model the same question, in parallel, then combine.
 *
 * Returns null when the council is disabled or no model answered, so callers
 * can fall back to the single-model path instead of inventing a verdict.
 */
export async function runAiCouncil(
  token: TokenSummary,
  ind: Indicators,
  patterns: ChartPattern[],
  safetyScore: number | null,
): Promise<CouncilVerdict | null> {
  const cfg = await getAdminConfig();
  if (!cfg.aiEnabled || !cfg.aiCouncilEnabled) return null;

  const panel = roster(cfg);
  if (panel.length === 0) return null;

  const prompt = buildAnalystPrompt(token, ind, patterns, safetyScore);

  // Parallel, and one slow or dead provider cannot block the rest.
  const settled = await Promise.all(
    panel.map(async (c) => {
      try {
        const text = await c.run(prompt);
        const parsed = parseVerdictJson(text);
        if (!parsed) return null;
        const member: CouncilMember = {
          provider: c.provider,
          model: c.model,
          lean: normalizeLean(parsed.lean),
          confidence: clampConfidence(parsed.confidence),
          reasoning: String(parsed.reasoning ?? "").slice(0, 400),
        };
        return { member, parsed };
      } catch {
        return null;
      }
    }),
  );

  const answers = settled.filter(
    (x): x is { member: CouncilMember; parsed: Partial<AiVerdict> } => x !== null,
  );
  if (answers.length === 0) return null;

  const members = answers.map((a) => a.member);

  // Vote weighted by each model's own stated confidence, so a hesitant vote
  // counts for less than a firm one.
  const weights: Record<Lean, number> = { bullish: 0, bearish: 0, neutral: 0 };
  const counts: Record<Lean, number> = { bullish: 0, bearish: 0, neutral: 0 };
  for (const m of members) {
    weights[m.lean] += Math.max(1, m.confidence);
    counts[m.lean] += 1;
  }

  const leans: Lean[] = ["bullish", "bearish", "neutral"];
  let winner: Lean = "neutral";
  for (const l of leans) if (weights[l] > weights[winner]) winner = l;

  const backers = members.filter((m) => m.lean === winner);
  const rawConfidence = Math.round(
    backers.reduce((s, m) => s + m.confidence, 0) / Math.max(1, backers.length),
  );

  // Agreement penalty. Unanimous keeps the full number; a 50/50 split keeps
  // three quarters of it; total disagreement keeps half.
  const agreement = backers.length / members.length;
  const confidence = clampConfidence(rawConfidence * (0.5 + 0.5 * agreement));

  const opposed = members.filter((m) => m.lean !== winner);
  const dissent =
    opposed.length === 0
      ? null
      : opposed.length +
        " of " +
        members.length +
        " models disagreed (" +
        opposed.map((m) => m.provider + ": " + m.lean).join(", ") +
        "), so confidence was reduced from " +
        rawConfidence +
        " to " +
        confidence +
        ".";

  // Narrative fields come from the most confident backer of the winning lean:
  // blending different models' price levels would produce numbers no model
  // actually endorsed.
  const lead =
    answers
      .filter((a) => a.member.lean === winner)
      .sort((a, b) => b.member.confidence - a.member.confidence)[0] ?? answers[0];

  const reasoningParts = members.map(
    (m) => m.provider + " (" + m.lean + ", " + m.confidence + "): " + m.reasoning,
  );

  return {
    lean: winner,
    confidence,
    rawConfidence,
    reasoning: reasoningParts.join(" | ").slice(0, 1200),
    entryZone: lead.parsed.entryZone ? String(lead.parsed.entryZone) : null,
    invalidation: lead.parsed.invalidation
      ? String(lead.parsed.invalidation)
      : null,
    targets: Array.isArray(lead.parsed.targets)
      ? lead.parsed.targets.map(String).slice(0, 4)
      : [],
    model: members.map((m) => m.provider).join(" + "),
    members,
    agreement,
    dissent,
  };
}

/**
 * Council verdict collapsed into the single-model AiVerdict shape, so existing
 * callers and UI keep working untouched.
 */
export function toAiVerdict(v: CouncilVerdict): AiVerdict {
  return {
    lean: v.lean,
    confidence: v.confidence,
    reasoning: v.dissent ? v.reasoning + " || " + v.dissent : v.reasoning,
    entryZone: v.entryZone,
    invalidation: v.invalidation,
    targets: v.targets,
    model: v.model,
  };
}
