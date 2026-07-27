// Top-holders + per-holder PnL for a given mint. Real on-chain reads.
// - getTopHolders: largest token accounts (getTokenLargestAccounts) resolved to
//   their owner wallets, with % of supply and current USD value.
// - getHolderTokenPnl: best-effort realized + unrealized PnL (in SOL) for one
//   wallet in this specific token, reconstructed from its Helius SWAP history.
//   Requires a Helius key; without one it reports needsKey (never fake numbers).
import { PublicKey } from "@solana/web3.js";
import { getConnection, getMintInfo, withRpcFailover } from "./rpc";
import { getAdminConfig } from "../adminConfig";
import { fetchJson } from "../http";
import { WSOL_MINT } from "../config";

export interface TopHolder {
  owner: string | null;
  tokenAccount: string;
  amount: number;
  pctSupply: number;
  valueUsd: number | null;
}

export interface TopHoldersResult {
  supply: number;
  holderCount: number;
  holders: TopHolder[];
}

// Holder lists barely move minute to minute, but every page view used to cost
// two fresh RPC calls. On a shared free endpoint that is what pushes the quota
// over the edge, so results are cached briefly and served to everyone.
const holdersCache = new Map<
  string,
  { value: TopHoldersResult; expiry: number }
>();
const HOLDERS_TTL_MS = 60_000;

/** Largest token accounts (up to 20) with owner + % of supply + USD value. */
export async function getTopHolders(
  mint: string,
  priceUsd: number | null,
): Promise<TopHoldersResult | null> {
  const cached = holdersCache.get(mint);
  if (cached && Date.now() < cached.expiry) {
    // Re-price the cached amounts so USD values stay current even on a cache hit.
    return {
      ...cached.value,
      holders: cached.value.holders.map((h) => ({
        ...h,
        valueUsd: priceUsd != null ? h.amount * priceUsd : null,
      })),
    };
  }

  const mintInfo = await getMintInfo(mint);
  if (!mintInfo || mintInfo.supply <= 0) return null;

  // Both reads go through the failover runner, so a 429 on one endpoint moves
  // to the next instead of surfacing as an error in the UI.
  // Explicit result types: the generic is inferred through a callback, so
  // annotating here keeps the downstream .map() calls fully typed.
  type LargestAccount = { address: PublicKey; uiAmount: number | null };
  const accounts = await withRpcFailover<LargestAccount[]>((conn) =>
    conn
      .getTokenLargestAccounts(new PublicKey(mint))
      .then((r) => r.value as unknown as LargestAccount[]),
  );
  if (accounts.length === 0) {
    return { supply: mintInfo.supply, holderCount: 0, holders: [] };
  }

  // Resolve each token-account address to its owner wallet in one batched call.
  const pubkeys = accounts.map((a) => a.address);
  let owners: (string | null)[] = accounts.map(() => null);
  try {
    type ParsedAccounts = {
      value: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null>;
    };
    const infos = (await withRpcFailover((conn) =>
      conn.getMultipleParsedAccounts(pubkeys),
    )) as unknown as ParsedAccounts;
    owners = infos.value.map((acc) => acc?.data?.parsed?.info?.owner ?? null);
  } catch {
    // Owner resolution is best-effort; fall back to token-account addresses.
  }

  const holders: TopHolder[] = accounts.map((a, i) => {
    const amount = Number(a.uiAmount ?? 0);
    return {
      owner: owners[i],
      tokenAccount: a.address.toBase58(),
      amount,
      pctSupply: (amount / mintInfo.supply) * 100,
      valueUsd: priceUsd != null ? amount * priceUsd : null,
    };
  });

  const result = {
    supply: mintInfo.supply,
    holderCount: holders.length,
    holders,
  };
  holdersCache.set(mint, {
    value: result,
    expiry: Date.now() + HOLDERS_TTL_MS,
  });
  return result;
}

interface HeliusTx {
  tokenTransfers?: Array<{
    mint: string;
    tokenAmount: number;
    fromUserAccount: string;
    toUserAccount: string;
  }>;
  nativeTransfers?: Array<{ amount: number; fromUserAccount: string; toUserAccount: string }>;
}

export interface HolderPnl {
  wallet: string;
  investedSol: number;   // SOL spent buying this token
  receivedSol: number;   // SOL received selling this token
  realizedSol: number;   // received - invested
  currentValueSol: number | null; // unrealized value of remaining holdings
  netSol: number | null; // realized + unrealized
  swaps: number;
  partial: boolean;      // history may be truncated (>= 100 txns)
  needsKey: boolean;
}

/**
 * Best-effort PnL (in SOL) for one wallet in one token, from Helius SWAP history.
 * This is an ESTIMATE: it reads up to the last 100 swaps and ignores fees and
 * multi-hop routing nuances. Honest by design - no key means no numbers.
 */
export async function getHolderTokenPnl(
  wallet: string,
  mint: string,
  currentValueSol: number | null,
): Promise<HolderPnl> {
  const empty = (needsKey: boolean): HolderPnl => ({
    wallet,
    investedSol: 0,
    receivedSol: 0,
    realizedSol: 0,
    currentValueSol,
    netSol: currentValueSol,
    swaps: 0,
    partial: false,
    needsKey,
  });

  const cfg = await getAdminConfig();
  if (!cfg.heliusApiKey) return empty(true);

  const url =
    `https://api.helius.xyz/v0/addresses/${encodeURIComponent(wallet)}` +
    `/transactions?api-key=${cfg.heliusApiKey}&type=SWAP&limit=100`;
  const txs = await fetchJson<HeliusTx[]>(url).catch(() => [] as HeliusTx[]);

  let investedSol = 0;
  let receivedSol = 0;
  let swaps = 0;
  for (const tx of txs) {
    const transfers = tx.tokenTransfers ?? [];
    const leg = transfers.find(
      (t) => t.mint === mint && (t.fromUserAccount === wallet || t.toUserAccount === wallet),
    );
    if (!leg) continue;
    swaps++;
    const bought = leg.toUserAccount === wallet;
    // SOL value of the swap: prefer a WSOL token leg, else summed native transfers.
    const wsolLeg = transfers.find((t) => t.mint === WSOL_MINT);
    let sol = 0;
    if (wsolLeg) {
      sol = wsolLeg.tokenAmount;
    } else {
      sol = (tx.nativeTransfers ?? []).reduce((s, n) => s + (n.amount ?? 0), 0) / 1e9;
    }
    if (bought) investedSol += sol;
    else receivedSol += sol;
  }

  const realizedSol = receivedSol - investedSol;
  return {
    wallet,
    investedSol,
    receivedSol,
    realizedSol,
    currentValueSol,
    netSol: realizedSol + (currentValueSol ?? 0),
    swaps,
    partial: txs.length >= 100,
    needsKey: false,
  };
}
