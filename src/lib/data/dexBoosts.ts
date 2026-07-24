// DexScreener "trending" proxy. DexScreener has no public trending endpoint, but
// its Boosted-tokens list (the paid promotions that surface on the trending tab)
// is public and free. We pull the top boosted Solana tokens and hydrate each
// with full market data. Any failure degrades to an empty list (caller falls
// back to the volume scan).
import { DEXSCREENER_BASE } from "../config";
import { fetchJson } from "../http";
import type { TokenSummary } from "../types";
import { getTokenSummary } from "./dexscreener";

interface BoostEntry {
  chainId: string;
  tokenAddress: string;
  amount?: number;
  totalAmount?: number;
}

export async function getBoostedSolanaTokens(limit = 30): Promise<TokenSummary[]> {
  const data = await fetchJson<BoostEntry[]>(
    `${DEXSCREENER_BASE}/token-boosts/top/v1`,
  ).catch(() => [] as BoostEntry[]);
  const list = (Array.isArray(data) ? data : [])
    .filter((b) => b.chainId === "solana")
    .slice(0, limit);
  const settled = await Promise.allSettled(
    list.map((b) => getTokenSummary(b.tokenAddress)),
  );
  const out: TokenSummary[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) out.push(r.value);
  }
  // Boosted order roughly reflects trending rank; keep it but drop dead pairs.
  return out.filter((t) => (t.liquidityUsd ?? 0) > 0);
}
