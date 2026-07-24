// Shared server-side execution layer used by auto-buy, copy-trade (#2), and the
// keeper (#7). Every buy passes the SAME rails: admin enabled, per-trade cap,
// safety gate, daily spend cap. Nothing here runs unless AUTO_BUY_SIGNER_KEY is
// configured. All swaps are REAL Jupiter swaps signed by the server hot wallet.
import { PublicKey } from "@solana/web3.js";
import {
  buildSwapTransaction,
  getBuyQuote,
  getSwapQuote,
  getSignerKeypair,
  signAndSendSwap,
} from "../solana/jupiter";
import { getConnection } from "../solana/rpc";
import { analyzeSafety } from "../data/safety";
import { getTokenSummary } from "../data/dexscreener";
import { getAdminConfig } from "../adminConfig";
import { getServiceClient } from "../supabase";
import { broadcastBuy } from "../notify/telegram";
import { notifyTrade } from "../notify/email";
import { WSOL_MINT } from "../config";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export interface BuyRequest {
  tokenAddress: string;
  amountSol: number;
  source: string; // auto | copy | keeper
  sourceRef?: string; // originating whale tx signature (copy dedupe)
  ownerId?: string | null;
  reason?: string | null; // e.g. "copy of Whale A"
}

export interface ExecResult {
  ok: boolean;
  signature?: string;
  error?: string;
  safetyScore?: number | null;
  proceedsSol?: number;
  pnlSol?: number | null;
}

async function spentLast24h(): Promise<number> {
  const db = getServiceClient();
  if (!db) return 0;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await db
    .from("buy_orders")
    .select("amount_sol")
    .gte("created_at", since)
    .in("status", ["submitted", "confirmed"]);
  return (data ?? []).reduce((s, r) => s + Number(r.amount_sol ?? 0), 0);
}

/** Sum of confirmed SOL cost basis for a token (optionally one owner). */
async function costBasisSol(
  tokenAddress: string,
  ownerId?: string | null,
): Promise<number> {
  const db = getServiceClient();
  if (!db) return 0;
  let q = db
    .from("buy_orders")
    .select("amount_sol, owner_id")
    .eq("token_address", tokenAddress)
    .in("status", ["submitted", "confirmed"]);
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data } = await q;
  return (data ?? []).reduce((s, r) => s + Number(r.amount_sol ?? 0), 0);
}

/** Execute a server-signed BUY through every safety rail. */
export async function executeServerBuy(req: BuyRequest): Promise<ExecResult> {
  const cfg = await getAdminConfig();
  const db = getServiceClient();

  if (!cfg.autoBuyEnabled) return { ok: false, error: "Auto-buy disabled." };
  const signer = getSignerKeypair();
  if (!signer) return { ok: false, error: "AUTO_BUY_SIGNER_KEY not configured." };

  const amount = Number(req.amountSol);
  if (!amount || amount <= 0) return { ok: false, error: "Invalid amount." };
  if (amount > cfg.maxBuySol)
    return { ok: false, error: `Exceeds per-buy cap ${cfg.maxBuySol} SOL.` };

  // Safety gate.
  const safety = await analyzeSafety(req.tokenAddress).catch(() => null);
  const safetyScore = safety?.score ?? null;
  if (safetyScore == null || safetyScore < cfg.requireSafeScore) {
    return {
      ok: false,
      safetyScore,
      error: `Safety ${safetyScore ?? "n/a"} below required ${cfg.requireSafeScore}.`,
    };
  }

  // Daily spend cap.
  const spent = await spentLast24h();
  if (spent + amount > cfg.dailySpendCapSol) {
    return { ok: false, error: `Daily spend cap ${cfg.dailySpendCapSol} SOL reached.` };
  }

  try {
    const quote = await getBuyQuote(req.tokenAddress, amount, cfg.slippageBps);
    const swapTx = await buildSwapTransaction(
      quote.raw,
      signer.publicKey.toBase58(),
    );
    const conn = await getConnection();
    const sig = await signAndSendSwap(swapTx, conn);

    if (db) {
      await db.from("buy_orders").insert({
        owner_id: req.ownerId ?? null,
        token_address: req.tokenAddress,
        amount_sol: amount,
        status: "confirmed",
        tx_signature: sig,
        safety_score: safetyScore,
        source: req.source,
        source_ref: req.sourceRef ?? null,
      });
    }

    // Notifications (Telegram broadcast + per-user email).
    const token = await getTokenSummary(req.tokenAddress).catch(() => null);
    const symbol = token?.symbol ?? req.tokenAddress.slice(0, 6);
    await broadcastBuy(symbol, amount, sig, req.source).catch(() => false);
    await notifyTrade({
      ownerId: req.ownerId ?? null,
      action: "buy",
      symbol,
      tokenAddress: req.tokenAddress,
      amountSol: amount,
      priceUsd: token?.priceUsd ?? null,
      source: req.source,
      signature: sig,
      reason: req.reason ?? null,
    }).catch(() => false);

    return { ok: true, signature: sig, safetyScore };
  } catch (err) {
    if (db) {
      await db.from("buy_orders").insert({
        owner_id: req.ownerId ?? null,
        token_address: req.tokenAddress,
        amount_sol: amount,
        status: "failed",
        safety_score: safetyScore,
        source: req.source,
        source_ref: req.sourceRef ?? null,
        error: (err as Error).message,
      });
    }
    return { ok: false, error: (err as Error).message, safetyScore };
  }
}

/** Raw balance (base units) + decimals of a token held by the signer wallet. */
async function signerTokenBalance(
  tokenAddress: string,
): Promise<{ raw: string; uiAmount: number } | null> {
  const signer = getSignerKeypair();
  if (!signer) return null;
  const conn = await getConnection();
  const resp = await conn.getParsedTokenAccountsByOwner(signer.publicKey, {
    programId: new PublicKey(TOKEN_PROGRAM_ID),
  });
  for (const { account } of resp.value) {
    const info = (account.data as any).parsed?.info;
    if (info?.mint === tokenAddress) {
      const amt = info.tokenAmount;
      if (Number(amt.amount) > 0)
        return { raw: String(amt.amount), uiAmount: Number(amt.uiAmount ?? 0) };
    }
  }
  return null;
}

export interface SellOpts {
  ownerId?: string | null;
  reason?: string | null; // e.g. take-profit / stop-loss
  symbol?: string | null;
}

/**
 * Execute a server-signed SELL of the signer wallet's FULL balance of a token
 * back to SOL (keeper take-profit / stop-loss). Computes proceeds + estimated
 * profit/loss vs known cost basis and emails the owner.
 */
export async function executeServerSellAll(
  tokenAddress: string,
  opts: SellOpts = {},
): Promise<ExecResult> {
  const cfg = await getAdminConfig();
  const signer = getSignerKeypair();
  if (!signer) return { ok: false, error: "AUTO_BUY_SIGNER_KEY not configured." };

  const bal = await signerTokenBalance(tokenAddress).catch(() => null);
  if (!bal) return { ok: false, error: "Signer holds none of this token." };

  try {
    const quote = await getSwapQuote(
      tokenAddress,
      WSOL_MINT,
      bal.raw,
      cfg.slippageBps,
    );
    const swapTx = await buildSwapTransaction(
      quote.raw,
      signer.publicKey.toBase58(),
    );
    const conn = await getConnection();
    const sig = await signAndSendSwap(swapTx, conn);

    // Proceeds (WSOL lamports -> SOL) and estimated PnL vs cost basis.
    const proceedsSol = Number(quote.outAmount) / 1e9;
    const cost = await costBasisSol(tokenAddress, opts.ownerId);
    const pnlSol = cost > 0 ? proceedsSol - cost : null;
    const pnlPct = cost > 0 ? ((proceedsSol - cost) / cost) * 100 : null;

    const token = await getTokenSummary(tokenAddress).catch(() => null);
    const symbol = opts.symbol ?? token?.symbol ?? tokenAddress.slice(0, 6);
    await notifyTrade({
      ownerId: opts.ownerId ?? null,
      action: "sell",
      symbol,
      tokenAddress,
      amountSol: proceedsSol,
      priceUsd: token?.priceUsd ?? null,
      source: "keeper",
      signature: sig,
      pnlSol,
      pnlPct,
      reason: opts.reason ?? null,
    }).catch(() => false);

    return { ok: true, signature: sig, proceedsSol, pnlSol };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
