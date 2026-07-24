// Portfolio / PnL (feature #4). Reads the wallet's SPL token accounts on-chain,
// prices each token via DexScreener, and joins known cost basis from buy_orders.
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "../solana/rpc";
import { getTokenSummary } from "./dexscreener";
import { getServiceClient } from "../supabase";
import { cached } from "../cache";
import type { PortfolioHolding, PortfolioResult } from "../types";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MIN_VALUE_USD = 1;

export async function getPortfolio(wallet: string): Promise<PortfolioResult> {
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

  const costByToken = new Map<string, number>();
  const db = getServiceClient();
  if (db) {
    const { data } = await db
      .from("buy_orders")
      .select("token_address, amount_sol, status")
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
  return { wallet, solBalance, holdings, totalValueUsd };
}
