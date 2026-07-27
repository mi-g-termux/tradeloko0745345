// On-chain history sync for custodial wallets.
//
// WHY THIS EXISTS
// ---------------
// wallet_transactions only ever received rows that THIS app wrote: buys, sells
// and withdrawals it performed itself. A plain incoming transfer - somebody
// sending SOL to their deposit address - happens entirely on Solana and never
// touches our code, so it was never recorded. The balance updated (that is read
// live from the chain) but the history stayed empty, which looks exactly like
// money disappearing.
//
// This module makes history authoritative the way Phantom does it: read the
// address's real signature list from the chain and record anything we have not
// seen. Deposits therefore appear automatically, with no webhook to configure.
//
// It is also self-healing for outbound transfers. If a withdrawal is broadcast
// but the confirmation wait times out, the old code never wrote a row at all;
// now the next sync finds the signature on-chain and records it, so the 24h
// spending cap cannot be bypassed by deliberately dropping the connection.
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { getConnection } from "../solana/rpc";
import { getServiceClient } from "../supabase";
import { getWalletPublicKey } from "./custodial";

/** How many recent signatures to examine per sync. */
const SCAN_LIMIT = 40;

/**
 * Transfers below this are ignored as dust/noise. Rent-exempt minimum on Solana
 * is ~0.00089 SOL, so this also filters account-creation side effects.
 */
const MIN_SOL = 0.000001;

export interface SyncResult {
  scanned: number;
  added: number;
  deposits: number;
  withdrawals: number;
}

const EMPTY: SyncResult = { scanned: 0, added: 0, deposits: 0, withdrawals: 0 };

/**
 * Net lamport change for `address` in a parsed transaction.
 *
 * Using pre/post balances rather than decoding instructions is deliberate: it
 * captures the true net effect of ANY transaction shape - a simple transfer, a
 * multi-instruction swap, a program that pays out - without having to teach this
 * function about every program on Solana.
 */
function lamportDelta(
  tx: ParsedTransactionWithMeta,
  address: string,
): number {
  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => k.pubkey.toBase58() === address);
  if (idx < 0 || !tx.meta) return 0;
  const pre = tx.meta.preBalances?.[idx];
  const post = tx.meta.postBalances?.[idx];
  if (typeof pre !== "number" || typeof post !== "number") return 0;
  return post - pre;
}

/** True when the transaction touched an SPL token account owned by us. */
function touchedTokens(tx: ParsedTransactionWithMeta): boolean {
  const pre = tx.meta?.preTokenBalances?.length ?? 0;
  const post = tx.meta?.postTokenBalances?.length ?? 0;
  return pre > 0 || post > 0;
}

/**
 * Reconcile a user's wallet_transactions with the chain.
 *
 * Safe to call often and concurrently: every candidate is matched against the
 * signatures already stored for this owner, so re-running it adds nothing.
 * Never throws - history is a convenience and must not break the wallet page.
 */
export async function syncWalletHistory(
  ownerId: string,
  limit: number = SCAN_LIMIT,
): Promise<SyncResult> {
  const db = getServiceClient();
  if (!db) return { ...EMPTY };

  const address = await getWalletPublicKey(ownerId).catch(() => null);
  if (!address) return { ...EMPTY };

  try {
    const conn = await getConnection();
    const sigs = await conn.getSignaturesForAddress(new PublicKey(address), {
      limit,
    });
    if (sigs.length === 0) return { ...EMPTY };

    // Which of these do we already know about?
    const candidates = sigs.map((s) => s.signature);
    const { data: known } = await db
      .from("wallet_transactions")
      .select("signature")
      .eq("owner_id", ownerId)
      .in("signature", candidates);

    const seen = new Set(
      (known ?? []).map((r) => String(r.signature)).filter(Boolean),
    );
    const fresh = sigs.filter((s) => !seen.has(s.signature));
    if (fresh.length === 0) {
      return { ...EMPTY, scanned: sigs.length };
    }

    // Fetch in one batch rather than N round trips.
    const parsed = await conn.getParsedTransactions(
      fresh.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0 },
    );

    const rows: Array<Record<string, unknown>> = [];
    let deposits = 0;
    let withdrawals = 0;

    for (let i = 0; i < fresh.length; i++) {
      const meta = fresh[i];
      const tx = parsed[i];
      if (!tx || !meta) continue;

      // A failed transaction moved nothing. Recording it as history would be
      // wrong, and counting it against the withdrawal cap doubly so.
      if (tx.meta?.err) continue;

      const delta = lamportDelta(tx, address);
      const sol = Math.abs(delta) / LAMPORTS_PER_SOL;
      if (sol < MIN_SOL) continue;

      // Token movement means this was a swap, not a plain transfer. Those are
      // already recorded by the trade engine with correct token metadata, so
      // anything reaching here unrecorded is logged neutrally rather than being
      // mislabelled a deposit or withdrawal.
      const isSwap = touchedTokens(tx);
      const kind = isSwap
        ? delta > 0
          ? "sell"
          : "buy"
        : delta > 0
          ? "deposit"
          : "withdraw";

      if (kind === "deposit") deposits++;
      if (kind === "withdraw") withdrawals++;

      rows.push({
        owner_id: ownerId,
        kind,
        sol_amount: sol,
        signature: meta.signature,
        status: "confirmed",
        note: isSwap ? "on-chain swap" : "on-chain transfer",
        // Use the real block time so history sorts correctly rather than
        // bunching every backfilled row at the moment of the first sync.
        created_at: meta.blockTime
          ? new Date(meta.blockTime * 1000).toISOString()
          : new Date().toISOString(),
      });
    }

    if (rows.length === 0) {
      return { ...EMPTY, scanned: sigs.length };
    }

    await db.from("wallet_transactions").insert(rows);

    return {
      scanned: sigs.length,
      added: rows.length,
      deposits,
      withdrawals,
    };
  } catch {
    // RPC rate limits are common on the public endpoint. A failed sync must
    // leave the existing history readable.
    return { ...EMPTY };
  }
}

/** Sync every custodial wallet. Used by the wallet-sync cron. */
export async function syncAllWallets(
  maxWallets = 60,
): Promise<{ wallets: number; added: number }> {
  const db = getServiceClient();
  if (!db) return { wallets: 0, added: 0 };

  const { data } = await db
    .from("user_wallets")
    .select("owner_id")
    .limit(maxWallets);

  let added = 0;
  for (const row of data ?? []) {
    const r = await syncWalletHistory(String(row.owner_id));
    added += r.added;
  }
  return { wallets: (data ?? []).length, added };
}
