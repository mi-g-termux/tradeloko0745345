// Real OHLCV candles from GeckoTerminal (FREE, no API key).
// Docs: https://www.geckoterminal.com/dex-api
// Endpoint: /networks/solana/pools/{pool}/ohlcv/{timeframe}
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

/**
 * Fetch candles for a pool (pair) address. GeckoTerminal keys OHLCV by pool,
 * not token, so pass the token's best pair address (TokenSummary.pairAddress).
 */
export async function getCandles(
  poolAddress: string,
  timeframe: Timeframe = "hour",
  aggregate = 1,
  limit = 200,
): Promise<Candle[]> {
  const url =
    `${GECKOTERMINAL_BASE}/networks/solana/pools/${encodeURIComponent(poolAddress)}` +
    `/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd`;
  const res = await fetchJson<GtOhlcvResponse>(url, {
    headers: { Accept: "application/json" },
  });
  const list = res.data?.attributes?.ohlcv_list ?? [];
  const candles: Candle[] = list.map((r) => ({
    time: r[0] * 1000,
    open: r[1],
    high: r[2],
    low: r[3],
    close: r[4],
    volume: r[5],
  }));
  // GeckoTerminal returns newest-first; return oldest-first for indicators.
  candles.sort((a, b) => a.time - b.time);
  return candles;
}
