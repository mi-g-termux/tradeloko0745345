// Portfolio / PnL (feature #4). Reads the wallet's SPL token accounts on-chain,
// prices each token via DexScreener, and joins known cost basis from buy_orders.
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "../solana/rpc";
import { getTokenSummary } from "./dexscreener";
import { getServiceClient } from "../supabase";
import { cached } from "../cache";
import type {
  PortfolioHolding,
  PortfolioResult,
  PortfolioStats,
} from "../types";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MIN_VALUE_USD = 1;

/**
 * Trading summary from this app's own records.
 *
 * Cost basis, win rate and hold time cannot be derived from the chain alone -
 * a bare address gives balances, not intent - so these come from buy_orders and
 * wallet_transactions. That means they only exist for a signed-in owner, and we
 * return null rather than guessing for anyone else.
 */
async function getStats(ownerId: string): Promise<PortfolioStats | null> {
  const db = getServiceClient();
  if (!db) return null;

  const [buysRes, txRes] = await Promise.all([
    db
      .from("buy_orders")
      .select("token_address, amount_sol, status, created_at")
      .eq("owner_id", ownerId)
      .in("status", ["submitted", "confirmed"]),
    db
      .from("wallet_transactions")
      .select("kind, token_address, sol_amount, status, created_at")
      .eq("owner_id", ownerId)
      .neq("status", "failed"),
  ]);

  const buys = buysRes.data ?? [];
  const txs = txRes.data ?? [];

  const num = (v: unknown): number => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  };

  let investedSol = 0;
  const firstBuyAt = new Map<string, number>();
  for (const b of buys) {
    investedSol += num(b.amount_sol);
    const t = b.created_at ? Date.parse(String(b.created_at)) : NaN;
    const mint = String(b.token_address ?? "");
    if (mint && Number.isFinite(t)) {
      const prev = firstBuyAt.get(mint);
      if (prev === undefined || t < prev) firstBuyAt.set(mint, t);
    }
  }

  let soldSol = 0;
  let depositedSol = 0;
  let withdrawnSol = 0;
  let tradeCount = buys.length;
  let lastTraded = 0;
  let winCount = 0;
  let lossCount = 0;
  const holdHours: number[] = [];

  // Cost paid per token, used to decide whether a sale was a win.
  const costByToken = new Map<string, number>();
  for (const b of buys) {
    const mint = String(b.token_address ?? "");
    if (!mint) continue;
    costByToken.set(mint, (costByToken.get(mint) ?? 0) + num(b.amount_sol));
  }

  for (const t of txs) {
    const amt = num(t.sol_amount);
    const kind = String(t.kind ?? "");
    const when = t.created_at ? Date.parse(String(t.created_at)) : NaN;

    if (kind === "deposit") depositedSol += amt;
    if (kind === "withdraw") withdrawnSol += amt;

    if (kind === "buy" || kind === "sell") {
      if (Number.isFinite(when) && when > lastTraded) lastTraded = when;
    }

    if (kind === "sell") {
      soldSol += amt;
      tradeCount++;
      const mint = String(t.token_address ?? "");
      const cost = mint ? (costByToken.get(mint) ?? 0) : 0;
      // Only judge a sale when we actually know what was paid. An unknown cost
      // basis is not a loss, and counting it as one would understate win rate.
      if (cost > 0) {
        if (amt > cost) winCount++;
        else lossCount++;
      }
      const opened = mint ? firstBuyAt.get(mint) : undefined;
      if (opened !== undefined && Number.isFinite(when) && when > opened) {
        holdHours.push((when - opened) / 3_600_000);
      }
    }
  }

  const closed = winCount + lossCount;

  return {
    investedSol,
    soldSol,
    realisedPnlSol: soldSol - investedSol,
    tradeCount,
    winCount,
    lossCount,
    winRate: closed > 0 ? (winCount / closed) * 100 : null,
    avgHoldHours:
      holdHours.length > 0
        ? holdHours.reduce((a, b) => a + b, 0) / holdHours.length
        : null,
    lastTradedAt: lastTraded > 0 ? new Date(lastTraded).toISOString() : null,
    depositedSol,
    withdrawnSol,
  };
}

export async function getPortfolio(
  wallet: string,
  ownerId?: string,
): Promise<PortfolioResult> {
  const conn = await getConnection();
  const owner = new PublicKey(wallet);

  const [lamports, resp] = await Promise.all([
    conn.getBalance(owner),
    conn.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(TOKEN_PROGRAM_ID) }),
  ]);
  const solBalance = lamports / 1e9;

  const raw: { mint: string; amount: number }[] = [];
  for (const { account } of resp.value) {
    const info = (account.data as any).parsed?.info;
    const amount = Number(info?.tokenAmount?.uiAmount ?? 0);
    if (info?.mint && amount > 0) raw.push({ mint: info.mint, amount });
  }

  // Cost basis is per OWNER. This query previously had no owner filter, so it
  // summed every user's buy_orders together and reported other people's spend
  // as this wallet's cost basis. Without an owner we show no cost basis at all,
  // which is the honest answer for an address we have no records for.
  const costByToken = new Map<string, number>();
  const db = getServiceClient();
  if (db && ownerId) {
    const { data } = await db
      .from("buy_orders")
      .select("token_address, amount_sol, status")
      .eq("owner_id", ownerId)
      .in("status", ["submitted", "confirmed"]);
    for (const o of data ?? []) {
      costByToken.set(o.token_address, (costByToken.get(o.token_address) ?? 0) + Number(o.amount_sol ?? 0));
    }
  }

  const holdings: PortfolioHolding[] = [];
  for (const r of raw) {
    const t = await cached(`price:${r.mint}`, 30_000, () => getTokenSummary(r.mint).catch(() => null));
    const price = t?.priceUsd ?? null;
    const value = price != null ? price * r.amount : null;
    if (value != null && value < MIN_VALUE_USD) continue;
    holdings.push({
      tokenAddress: r.mint,
      symbol: t?.symbol ?? r.mint.slice(0, 4),
      amount: r.amount,
      priceUsd: price,
      valueUsd: value,
      costSol: costByToken.get(r.mint) ?? null,
    });
  }

  holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const totalValueUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  const stats = ownerId ? await getStats(ownerId).catch(() => null) : null;
  return { wallet, solBalance, holdings, totalValueUsd, stats };
}
