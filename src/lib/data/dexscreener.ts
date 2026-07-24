// DexScreener integration — FREE, no API key required.
// Docs: https://docs.dexscreener.com/api/reference
// This is real market data: live prices, liquidity, volume, tx counts.
import { DEXSCREENER_BASE } from "../config";
import { fetchJson } from "../http";
import type { TokenSummary } from "../types";

interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  priceChange?: { h1?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

function pairToSummary(p: DexPair): TokenSummary {
  const created = p.pairCreatedAt ?? null;
  const ageHours =
    created != null ? (Date.now() - created) / 3_600_000 : null;
  return {
    address: p.baseToken.address,
    name: p.baseToken.name,
    symbol: p.baseToken.symbol,
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    priceChange1h: p.priceChange?.h1 ?? null,
    priceChange24h: p.priceChange?.h24 ?? null,
    liquidityUsd: p.liquidity?.usd ?? null,
    fdv: p.fdv ?? null,
    marketCap: p.marketCap ?? null,
    volume24h: p.volume?.h24 ?? null,
    txns24hBuys: p.txns?.h24?.buys ?? null,
    txns24hSells: p.txns?.h24?.sells ?? null,
    pairCreatedAt: created,
    ageHours,
    dexId: p.dexId ?? null,
    pairAddress: p.pairAddress ?? null,
    url: p.url ?? null,
    imageUrl: p.info?.imageUrl ?? null,
  };
}

// Keep only the deepest-liquidity pair per token so the scanner isn't noisy.
function dedupeByToken(pairs: DexPair[]): DexPair[] {
  const best = new Map<string, DexPair>();
  for (const p of pairs) {
    const key = p.baseToken.address;
    const prev = best.get(key);
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) {
      best.set(key, p);
    }
  }
  return [...best.values()];
}

/** Free-text / symbol search across Solana pairs. */
export async function searchTokens(query: string): Promise<TokenSummary[]> {
  const data = await fetchJson<{ pairs?: DexPair[] }>(
    `${DEXSCREENER_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`,
  );
  const pairs = (data.pairs ?? []).filter((p) => p.chainId === "solana");
  return dedupeByToken(pairs).map(pairToSummary);
}

/** Full detail for a single token address (returns its best pair). */
export async function getTokenSummary(
  address: string,
): Promise<TokenSummary | null> {
  const data = await fetchJson<{ pairs?: DexPair[] }>(
    `${DEXSCREENER_BASE}/latest/dex/tokens/${encodeURIComponent(address)}`,
  );
  const pairs = (data.pairs ?? []).filter((p) => p.chainId === "solana");
  if (pairs.length === 0) return null;
  const best = dedupeByToken(pairs)[0];
  return pairToSummary(best);
}

export async function getPairsForToken(address: string): Promise<TokenSummary[]> {
  const data = await fetchJson<{ pairs?: DexPair[] }>(
    `${DEXSCREENER_BASE}/latest/dex/tokens/${encodeURIComponent(address)}`,
  );
  const pairs = (data.pairs ?? []).filter((p) => p.chainId === "solana");
  return pairs.map(pairToSummary);
}

// Curated trending seeds. DexScreener has no public 'trending' list, so we
// scan several popular Solana memecoin terms and merge/rank by momentum.
// This is REAL data — just aggregated client-side.
const SCAN_TERMS = [
  "SOL",
  "solana meme",
  "pump",
  "bonk",
  "wif",
  "cat",
  "dog",
  "pepe",
];

export type ScanSort = "volume" | "gainers" | "new";

export async function scanTrending(
  sort: ScanSort = "volume",
  limit = 50,
): Promise<TokenSummary[]> {
  const results = await Promise.allSettled(
    SCAN_TERMS.map((t) => searchTokens(t)),
  );
  const merged = new Map<string, TokenSummary>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const t of r.value) {
      if (!merged.has(t.address)) merged.set(t.address, t);
    }
  }
  let list = [...merged.values()].filter(
    (t) => (t.liquidityUsd ?? 0) > 1000 && (t.volume24h ?? 0) > 1000,
  );
  if (sort === "gainers") {
    list.sort((a, b) => (b.priceChange24h ?? -999) - (a.priceChange24h ?? -999));
  } else if (sort === "new") {
    list.sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0));
  } else {
    list.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  }
  return list.slice(0, limit);
}
