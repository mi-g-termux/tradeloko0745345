// Real OHLCV candles from GeckoTerminal (FREE, no API key).
// Docs: https://www.geckoterminal.com/dex-api
// Endpoint: /networks/solana/pools/{pool}/ohlcv/{timeframe}
//
// ── Why this file was rewritten ────────────────────────────────────────────
// The signal engine always asked for HOURLY candles. Memecoins are usually
// minutes-to-hours old, so an hourly request returned 3-10 bars — far too few
// for EMA50/MACD/patterns. That silently produced near-empty indicator sets and
// was the main reason signals looked inaccurate and inconsistent.
//
// Now the timeframe is chosen from the token's actual age, and we walk DOWN to
// finer timeframes until we have enough bars to compute real indicators.
import { GECKOTERMINAL_BASE } from "../config";
import { fetchJson } from "../http";
import type { Candle } from "../types";

export type Timeframe = "minute" | "hour" | "day";

interface GtOhlcvResponse {
  data?: {
    attributes?: {
      // Each row: [timestamp_seconds, open, high, low, close, volume]
      ohlcv_list?: Array<[number, number, number, number, number, number]>;
    };
  };
}

/** A candle request: timeframe + aggregate (e.g. minute/5 = 5-minute bars). */
export interface CandleSpec {
  timeframe: Timeframe;
  aggregate: number;
  /** Human label used in the UI / signal quality report. */
  label: string;
}

export const CANDLE_SPECS: Record<string, CandleSpec> = {
  m1: { timeframe: "minute", aggregate: 1, label: "1m" },
  m5: { timeframe: "minute", aggregate: 5, label: "5m" },
  m15: { timeframe: "minute", aggregate: 15, label: "15m" },
  h1: { timeframe: "hour", aggregate: 1, label: "1h" },
  h4: { timeframe: "hour", aggregate: 4, label: "4h" },
  d1: { timeframe: "day", aggregate: 1, label: "1d" },
};

// Short-lived cache so one page view (chart + signal + AI) hits the API once.
// GeckoTerminal is free but rate-limited (~30 req/min), and the scanner cron
// analyses many tokens per run.
const CACHE_TTL_MS = 45_000;
const cache = new Map<string, { at: number; candles: Candle[] }>();

function cacheKey(pool: string, spec: CandleSpec, limit: number): string {
  return `${pool}:${spec.timeframe}:${spec.aggregate}:${limit}`;
}

function pruneCache(): void {
  if (cache.size < 400) return;
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
}

/**
 * Fetch candles for a pool (pair) address. GeckoTerminal keys OHLCV by pool,
 * not token, so pass the token's best pair address (TokenSummary.pairAddress).
 *
 * Accepts either a raw timeframe (legacy call style) or a CandleSpec.
 */
export async function getCandles(
  poolAddress: string,
  timeframe: Timeframe | CandleSpec = "hour",
  aggregate = 1,
  limit = 300,
): Promise<Candle[]> {
  const spec: CandleSpec =
    typeof timeframe === "string"
      ? { timeframe, aggregate, label: `${aggregate}${timeframe[0]}` }
      : timeframe;

  const key = cacheKey(poolAddress, spec, limit);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.candles;

  const url =
    `${GECKOTERMINAL_BASE}/networks/solana/pools/${encodeURIComponent(poolAddress)}` +
    `/ohlcv/${spec.timeframe}?aggregate=${spec.aggregate}&limit=${limit}&currency=usd`;

  const res = await fetchJson<GtOhlcvResponse>(url, {
    headers: { Accept: "application/json;version=20230302" },
  });

  const list = res.data?.attributes?.ohlcv_list ?? [];
  const candles: Candle[] = list
    .map((r) => ({
      time: r[0] * 1000,
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    // Drop malformed rows rather than letting NaN poison every indicator.
    .filter(
      (c) =>
        Number.isFinite(c.close) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        c.close > 0,
    );

  // GeckoTerminal returns newest-first; return oldest-first for indicators.
  candles.sort((a, b) => a.time - b.time);

  pruneCache();
  cache.set(key, { at: Date.now(), candles });
  return candles;
}

/**
 * Pick the best starting timeframe for a token's age so we get a usable number
 * of bars. Roughly targets 100-300 candles of history.
 */
export function specForAge(ageHours: number | null | undefined): CandleSpec[] {
  const age = ageHours ?? 0;
  // Order matters: first entry is preferred, the rest are fallbacks.
  if (age <= 3) return [CANDLE_SPECS.m1, CANDLE_SPECS.m5, CANDLE_SPECS.m15];
  if (age <= 12) return [CANDLE_SPECS.m5, CANDLE_SPECS.m1, CANDLE_SPECS.m15];
  if (age <= 72) return [CANDLE_SPECS.m15, CANDLE_SPECS.m5, CANDLE_SPECS.h1];
  if (age <= 24 * 30)
    return [CANDLE_SPECS.h1, CANDLE_SPECS.m15, CANDLE_SPECS.h4];
  return [CANDLE_SPECS.h4, CANDLE_SPECS.h1, CANDLE_SPECS.d1];
}

export interface AdaptiveCandles {
  candles: Candle[];
  spec: CandleSpec;
  /** Every timeframe we tried, for debugging/telemetry. */
  attempts: Array<{ label: string; count: number }>;
}

/**
 * Fetch the finest timeframe that yields enough candles for real indicators.
 *
 * Walks the age-appropriate timeframe list and stops at the first one with
 * `minCandles` bars. If none reach the target, it returns the attempt that
 * produced the MOST bars (best available evidence) instead of an empty array.
 */
export async function getAdaptiveCandles(
  poolAddress: string,
  ageHours: number | null | undefined,
  minCandles = 60,
  limit = 300,
): Promise<AdaptiveCandles> {
  const specs = specForAge(ageHours);
  const attempts: Array<{ label: string; count: number }> = [];
  let best: { candles: Candle[]; spec: CandleSpec } = {
    candles: [],
    spec: specs[0],
  };

  for (const spec of specs) {
    let candles: Candle[] = [];
    try {
      candles = await getCandles(poolAddress, spec, spec.aggregate, limit);
    } catch {
      // A single timeframe failing (404 / rate limit) must not kill the signal.
      candles = [];
    }
    attempts.push({ label: spec.label, count: candles.length });

    if (candles.length > best.candles.length) best = { candles, spec };
    if (candles.length >= minCandles) break;
  }

  return { candles: best.candles, spec: best.spec, attempts };
}
