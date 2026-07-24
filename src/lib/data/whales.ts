// Whale / copy-trade tracking via Helius (real on-chain transaction history).
// Requires a Helius API key (free tier available at https://helius.dev).
// Without a key this returns an empty list plus a 'needs key' flag — never
// fake data.
import { getAdminConfig } from "../adminConfig";
import { fetchJson } from "../http";
import { WSOL_MINT } from "../config";
import type { WalletActivity } from "../types";

export interface WhaleResult {
  enabled: boolean;
  needsKey: boolean;
  activity: WalletActivity[];
}

interface HeliusTx {
  signature: string;
  timestamp: number;
  type: string;
  tokenTransfers?: Array<{
    mint: string;
    tokenAmount: number;
    fromUserAccount: string;
    toUserAccount: string;
  }>;
  nativeTransfers?: Array<{
    amount: number;
    fromUserAccount: string;
    toUserAccount: string;
  }>;
}

/**
 * Recent SWAP activity for a wallet, classified as buy/sell of SPL tokens.
 * Uses Helius Enhanced Transactions API.
 */
export async function getWalletActivity(
  wallet: string,
  label?: string,
): Promise<WhaleResult> {
  const cfg = await getAdminConfig();
  if (!cfg.whaleTrackingEnabled) {
    return { enabled: false, needsKey: !cfg.heliusApiKey, activity: [] };
  }
  if (!cfg.heliusApiKey) {
    return { enabled: true, needsKey: true, activity: [] };
  }

  const url =
    `https://api.helius.xyz/v0/addresses/${encodeURIComponent(wallet)}` +
    `/transactions?api-key=${cfg.heliusApiKey}&type=SWAP&limit=25`;
  const txs = await fetchJson<HeliusTx[]>(url).catch(() => [] as HeliusTx[]);

  const activity: WalletActivity[] = [];
  for (const tx of txs) {
    const transfers = tx.tokenTransfers ?? [];
    // Find the non-SOL token leg to identify what was traded.
    const tokenLeg = transfers.find((t) => t.mint && t.mint !== WSOL_MINT);
    if (!tokenLeg) continue;
    const received = tokenLeg.toUserAccount === wallet;
    const solLeg = (tx.nativeTransfers ?? []).reduce(
      (s, n) => s + (n.amount ?? 0),
      0,
    );
    activity.push({
      wallet,
      label,
      action: received ? "buy" : "sell",
      tokenAddress: tokenLeg.mint,
      amountSol: solLeg ? solLeg / 1e9 : undefined,
      signature: tx.signature,
      timestamp: tx.timestamp * 1000,
    });
  }
  return { enabled: true, needsKey: false, activity };
}
