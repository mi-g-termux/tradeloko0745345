// DexScreener integration — FREE, no API key required.
// Docs: https://docs.dexscreener.com/api/reference
// This is real market data: live prices, liquidity, volume, tx counts.
import { DEXSCREENER_BASE } from "../config";
import { fetchJson } from "../http";
import type { TokenSummary } from "../types";

interface DexTxnWindow {
  buys?: number;
  sells?: number;
}

interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  // DexScreener exposes m5 / h1 / h6 / h24 windows for change, volume and txns.
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: {
    m5?: DexTxnWindow;
    h1?: DexTxnWindow;
    h6?: DexTxnWindow;
    h24?: DexTxnWindow;
  };
  pairCreatedAt?: number;
  boosts?: { active?: number };
  info?: {
    imageUrl?: string;
    websites?: Array<{ label?: string; url?: string }>;
    socials?: Array<{ type?: string; platform?: string; url?: string; handle?: string }>;
  };
}

/** Sum a txn window into a single count (buys + sells). */
function txnTotal(w: DexTxnWindow | undefined): number | null {
  if (!w) return null;
  const buys = w.buys ?? 0;
  const sells = w.sells ?? 0;
  if (buys === 0 && sells === 0) return 0;
  return buys + sells;
}

function findSocial(
  p: DexPair,
  ...types: string[]
): string | null {
  const socials = p.info?.socials ?? [];
  for (const s of socials) {
    const kind = (s.type ?? s.platform ?? "").toLowerCase();
    if (types.includes(kind) && s.url) return s.url;
  }
  return null;
}

function pairToSummary(p: DexPair): TokenSummary {
  const created = p.pairCreatedAt ?? null;
  const ageHours =
    created != null ? (Date.now() - created) / 3_600_000 : null;
  const buys24 = p.txns?.h24?.buys ?? null;
  const sells24 = p.txns?.h24?.sells ?? null;
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
    txns24hBuys: buys24,
    txns24hSells: sells24,
    pairCreatedAt: created,
    ageHours,
    dexId: p.dexId ?? null,
    pairAddress: p.pairAddress ?? null,
    url: p.url ?? null,
    imageUrl: p.info?.imageUrl ?? null,
    // ── Multi-timeframe columns (DexScreener-style scanner table). ──
    priceChange5m: p.priceChange?.m5 ?? null,
    priceChange6h: p.priceChange?.h6 ?? null,
    volume5m: p.volume?.m5 ?? null,
    volume1h: p.volume?.h1 ?? null,
    volume6h: p.volume?.h6 ?? null,
    txns5m: txnTotal(p.txns?.m5),
    txns1h: txnTotal(p.txns?.h1),
    txns6h: txnTotal(p.txns?.h6),
    txns24h: txnTotal(p.txns?.h24),
    buys5m: p.txns?.m5?.buys ?? null,
    sells5m: p.txns?.m5?.sells ?? null,
    // DexScreener does not publish unique makers on the free endpoint, so we
    // report the 24h txn count as the trader-activity proxy and label it as
    // such in the UI (never presented as a verified unique-wallet count).
    traders24h:
      buys24 != null || sells24 != null ? (buys24 ?? 0) + (sells24 ?? 0) : null,
    boosts: p.boosts?.active ?? null,
    quoteSymbol: p.quoteToken?.symbol ?? null,
    websiteUrl: p.info?.websites?.[0]?.url ?? null,
    twitterUrl: findSocial(p, "twitter", "x"),
    telegramUrl: findSocial(p, "telegram"),
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

// Majors / stables that flood keyword search but aren't memecoin plays. We drop
// them from the trending scan so the same SOL/USDC rows don't repeat.
const EXCLUDE_SYMBOLS = new Set([
  "SOL",
  "WSOL",
  "USDC",
  "USDT",
  "USDH",
  "JUP",
  "JLP",
  "JITOSOL",
  "MSOL",
  "BSOL",
  "WBTC",
  "WETH",
  "ETH",
  "BTC",
]);

export type ScanSort = "trending" | "volume" | "gainers" | "new" | "searched";

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
  // The "new" tab should surface freshly-created pairs even with tiny
  // liquidity/volume; only the momentum tabs need a floor to cut noise.
  const minLiq = sort === "new" ? 0 : 1000;
  const minVol = sort === "new" ? 0 : 1000;
  let list = [...merged.values()].filter(
    (t) =>
      (t.liquidityUsd ?? 0) >= minLiq &&
      (t.volume24h ?? 0) >= minVol &&
      !EXCLUDE_SYMBOLS.has((t.symbol || "").toUpperCase()),
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
