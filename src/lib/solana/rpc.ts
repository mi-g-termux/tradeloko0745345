// Direct Solana JSON-RPC helpers using @solana/web3.js.
// Free public RPC works but is rate-limited; set a paid RPC in admin config.
import { Connection, PublicKey } from "@solana/web3.js";
import { getRpcUrl } from "../adminConfig";

export async function getConnection(): Promise<Connection> {
  const url = await getRpcUrl();
  return new Connection(url, "confirmed");
}

export interface MintInfo {
  mint: string;
  supply: number;
  decimals: number;
  mintAuthority: string | null;   // non-null => team can print more tokens (risk)
  freezeAuthority: string | null; // non-null => team can freeze your tokens (risk)
}

/** Parsed SPL mint account: authorities + supply. Real on-chain read. */
export async function getMintInfo(mint: string): Promise<MintInfo | null> {
  const conn = await getConnection();
  const info = await conn.getParsedAccountInfo(new PublicKey(mint));
  const value = info.value;
  if (!value || !("parsed" in value.data)) return null;
  const parsed = value.data.parsed as {
    type: string;
    info: {
      decimals: number;
      supply: string;
      mintAuthority: string | null;
      freezeAuthority: string | null;
    };
  };
  if (parsed.type !== "mint") return null;
  const decimals = parsed.info.decimals;
  const supply = Number(parsed.info.supply) / 10 ** decimals;
  return {
    mint,
    supply,
    decimals,
    mintAuthority: parsed.info.mintAuthority,
    freezeAuthority: parsed.info.freezeAuthority,
  };
}

export interface HolderConcentration {
  topHolderPct: number;   // % of supply in the single largest account
  top10Pct: number;       // % of supply in the top 10 accounts
  accountsChecked: number;
}

/**
 * Largest token accounts via getTokenLargestAccounts (returns up to 20).
 * Gives a real read on holder concentration — a key rug signal.
 */
export async function getHolderConcentration(
  mint: string,
): Promise<HolderConcentration | null> {
  const conn = await getConnection();
  const mintInfo = await getMintInfo(mint);
  if (!mintInfo || mintInfo.supply <= 0) return null;
  const largest = await conn.getTokenLargestAccounts(new PublicKey(mint));
  const amounts = largest.value.map((a) => Number(a.uiAmount ?? 0));
  if (amounts.length === 0) return null;
  const top1 = amounts[0] ?? 0;
  const top10 = amounts.slice(0, 10).reduce((s, v) => s + v, 0);
  return {
    topHolderPct: (top1 / mintInfo.supply) * 100,
    top10Pct: (top10 / mintInfo.supply) * 100,
    accountsChecked: amounts.length,
  };
}
