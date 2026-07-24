// POST /api/swap/auto  { outputMint, solAmount }  (ADMIN ONLY)
// Server-side auto-buy: quote -> safety gate -> spend caps -> sign & send with
// the configured signer key. Every rail must pass or the buy is refused.
//
// ⚠ SECURITY: auto-buy requires AUTO_BUY_SIGNER_KEY (a hot wallet private key)
// in the server environment. Fund it with ONLY what you can afford to lose.
import { NextRequest, NextResponse } from "next/server";
import { getBuyQuote, signAndSendSwap, buildSwapTransaction } from "@/lib/solana/jupiter";
import { getConnection } from "@/lib/solana/rpc";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { analyzeSafety } from "@/lib/data/safety";
import { getAdminConfig } from "@/lib/adminConfig";
import { requireAdmin } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";
import { broadcastBuy } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const cfg = await getAdminConfig();
  if (!cfg.autoBuyEnabled) {
    return NextResponse.json(
      { error: "Auto-buy is disabled in admin settings." },
      { status: 403 },
    );
  }
  const signerSecret = process.env.AUTO_BUY_SIGNER_KEY ?? "";
  if (!signerSecret) {
    return NextResponse.json(
      { error: "AUTO_BUY_SIGNER_KEY not configured on the server." },
      { status: 503 },
    );
  }

  const { outputMint, solAmount } = await req.json();
  const amount = Number(solAmount);
  if (!outputMint || !amount || amount <= 0) {
    return NextResponse.json({ error: "Missing/invalid fields" }, { status: 400 });
  }

  // Rail 1: per-trade cap.
  if (amount > cfg.maxBuySol) {
    return NextResponse.json(
      { error: `Amount exceeds per-buy cap of ${cfg.maxBuySol} SOL.` },
      { status: 400 },
    );
  }

  // Rail 2: safety gate.
  const safety = await analyzeSafety(outputMint);
  if (safety.score < cfg.requireSafeScore) {
    return NextResponse.json(
      {
        error: `Refused: safety score ${safety.score} is below required ${cfg.requireSafeScore}.`,
        safety,
      },
      { status: 412 },
    );
  }

  // Rail 3: daily spend cap.
  const db = getServiceClient();
  if (db) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await db
      .from("buy_orders")
      .select("amount_sol")
      .gte("created_at", since)
      .in("status", ["submitted", "confirmed"]);
    const spent = (recent ?? []).reduce(
      (s, r) => s + Number(r.amount_sol ?? 0),
      0,
    );
    if (spent + amount > cfg.dailySpendCapSol) {
      return NextResponse.json(
        { error: `Refused: daily spend cap of ${cfg.dailySpendCapSol} SOL would be exceeded.` },
        { status: 429 },
      );
    }
  }

  // Execute: quote -> build for signer pubkey -> sign & send.
  try {
    const signer = Keypair.fromSecretKey(bs58.decode(signerSecret));
    const quote = await getBuyQuote(outputMint, amount, cfg.slippageBps);
    const swapTx = await buildSwapTransaction(quote.raw, signer.publicKey.toBase58());
    const conn = await getConnection();
    const sig = await signAndSendSwap(swapTx, conn);

    if (db) {
      await db.from("buy_orders").insert({
        token_address: outputMint,
        amount_sol: amount,
        status: "confirmed",
        tx_signature: sig,
        safety_score: safety.score,
        source: "auto",
      });
    }
    // Best-effort Telegram alert (no-ops if alerts are off/unconfigured).
    await broadcastBuy(outputMint.slice(0, 6), amount, sig, "auto").catch(() => false);
    return NextResponse.json({ ok: true, signature: sig, safety });
  } catch (err) {
    if (db) {
      await db.from("buy_orders").insert({
        token_address: outputMint,
        amount_sol: amount,
        status: "failed",
        safety_score: safety.score,
        source: "auto",
        error: (err as Error).message,
      });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
