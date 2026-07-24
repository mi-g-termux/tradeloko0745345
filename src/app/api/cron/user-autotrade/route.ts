// GET/POST /api/cron/user-autotrade
// Per-user auto-trading. For every user who has enabled auto-trade, this buys
// recent strong bullish signals from THEIR OWN custodial wallet, within their
// per-buy cap, daily cap, remaining balance, and the admin safety gate.
// Auth: `Authorization: Bearer $CRON_SECRET` (or ?key= for manual testing).
import { NextRequest, NextResponse } from "next/server";
import { SERVER_ENV } from "@/lib/config";
import { getServiceClient } from "@/lib/supabase";
import { getAdminConfig } from "@/lib/adminConfig";
import { analyzeSafety } from "@/lib/data/safety";
import { getSolBalance, getWalletPublicKey } from "@/lib/wallet/custodial";
import { buyWithUserWallet } from "@/lib/trade/custodialTrade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BULLISH = new Set(["up", "bullish", "long", "buy", "strong_buy"]);
const MAX_BUYS_PER_RUN = 12;

function authorized(req: NextRequest): boolean {
  const secret = SERVER_ENV.cronSecret;
  if (!secret) return false;
  if ((req.headers.get("authorization") ?? "") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("key") === secret;
}

async function spentLast24h(db: any, ownerId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await db
    .from("wallet_transactions")
    .select("sol_amount")
    .eq("owner_id", ownerId)
    .eq("kind", "buy")
    .gte("created_at", since);
  return (data ?? []).reduce((s: number, r: any) => s + Number(r.sol_amount ?? 0), 0);
}

async function alreadyHeld(db: any, ownerId: string, token: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await db
    .from("wallet_transactions")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("kind", "buy")
    .eq("token_address", token)
    .gte("created_at", since)
    .limit(1);
  return (data ?? []).length > 0;
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getServiceClient();
  if (!db) return NextResponse.json({ ok: true, skipped: true, reason: "No database." });

  const cfg = await getAdminConfig();

  // Recent bullish signals (last 90 min).
  const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const { data: signals } = await db
    .from("signals")
    .select("token_address, symbol, direction, confidence, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);
  const candidates = (signals ?? []).filter(
    (s: any) => BULLISH.has(String(s.direction ?? "").toLowerCase()),
  );

  // Users who opted in.
  const { data: optedIn } = await db
    .from("user_trade_settings")
    .select("owner_id, auto_trade_enabled, max_buy_sol, daily_cap_sol, min_confidence")
    .eq("auto_trade_enabled", true);

  const safetyCache = new Map<string, number | null>();
  let executed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const u of optedIn ?? []) {
    if (executed >= MAX_BUYS_PER_RUN) break;
    const ownerId = u.owner_id as string;
    const pubkey = await getWalletPublicKey(ownerId);
    if (!pubkey) continue;

    const maxBuy = Number(u.max_buy_sol ?? 0);
    const dailyCap = Number(u.daily_cap_sol ?? 0);
    const minConf = Number(u.min_confidence ?? 70);
    if (maxBuy <= 0) continue;

    const balance = await getSolBalance(pubkey).catch(() => 0);
    if (balance < maxBuy + 0.003) continue;
    const spent = await spentLast24h(db, ownerId);
    let remaining = dailyCap - spent;
    if (remaining <= 0) continue;

    for (const sig of candidates) {
      if (executed >= MAX_BUYS_PER_RUN) break;
      if (Number(sig.confidence ?? 0) < minConf) continue;
      const token = sig.token_address as string;
      if (await alreadyHeld(db, ownerId, token)) continue;

      // Safety gate (shared with server auto-buy rails).
      if (!safetyCache.has(token)) {
        const safety = await analyzeSafety(token).catch(() => null);
        safetyCache.set(token, safety?.score ?? null);
      }
      const score = safetyCache.get(token) ?? null;
      if (score == null || score < cfg.requireSafeScore) continue;

      const amount = Math.min(maxBuy, remaining);
      if (amount <= 0) break;

      const res = await buyWithUserWallet(ownerId, token, amount);
      results.push({ ownerId, token, symbol: sig.symbol ?? null, amount, ok: res.ok, error: res.error });
      if (res.ok) {
        executed++;
        remaining -= amount;
        if (remaining <= 0) break;
      }
    }
  }

  return NextResponse.json({ ok: true, executed, results });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
