// Direct Solana JSON-RPC helpers using @solana/web3.js.
// Free public RPC works but is rate-limited; set a paid RPC in admin config.
import { Connection, PublicKey } from "@solana/web3.js";
import { getRpcUrl, getRpcUrls } from "../adminConfig";

export async function getConnection(): Promise<Connection> {
  const url = await getRpcUrl();
  return new Connection(url, "confirmed");
}

/** True for errors worth retrying on a different endpoint. */
function isRateLimitOrOutage(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run an RPC read against each configured endpoint until one succeeds.
 *
 * The free endpoint api.mainnet-beta.solana.com allows only a few requests per
 * second PER IP, and on a serverless host that IP is shared with every other
 * tenant on the machine. That is why holder reads fail with
 * "429 Too many requests for a specific RPC call" even when the site is idle:
 * the quota was already spent by somebody else.
 *
 * Order comes from getRpcUrls(): Helius first (a dedicated key means a
 * dedicated quota), then the admin's primary, then the backup, then public.
 * A 429 also gets one short backoff retry before moving on, since these limits
 * are per-second and usually clear immediately.
 */
export async function withRpcFailover<T>(
  run: (conn: Connection) => Promise<T>,
): Promise<T> {
  const urls = await getRpcUrls();
  let lastErr: unknown = new Error("No RPC endpoint configured.");

  for (const url of urls) {
    const conn = new Connection(url, "confirmed");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await run(conn);
      } catch (err) {
        lastErr = err;
        if (!isRateLimitOrOutage(err)) throw err;
        if (attempt === 0) await sleep(350);
      }
    }
  }
  throw lastErr;
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
