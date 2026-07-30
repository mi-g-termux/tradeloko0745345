// GET  /api/boost -> what's on sale, the buyer's own orders, and their balance
// POST /api/boost -> create a pending order  { tokenAddress: string, tier: number }
//
// The payout address is only exposed when boosts are actually on sale, so we
// never invite a payment that cannot be honoured.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getAdminConfig, boostsReady } from "@/lib/adminConfig";
import {
  autoVerifyPendingBoosts,
  createBoostOrder,
  getActiveBoosts,
  listOwnerBoosts,
  publicPackages,
} from "@/lib/boost/boosts";
import { getWalletOverview } from "@/lib/wallet/custodial";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await getAdminConfig();
  const ready = boostsReady(cfg);
  const user = await getCurrentUser();

  // Opportunistic check so a buyer who just sent SOL sees it credited on the
  // next refresh rather than waiting for the cron tick. Best-effort only: a
  // slow or throttled RPC must never block the page from rendering.
  if (ready) {
    try {
      await autoVerifyPendingBoosts();
    } catch {
      // The cron job will retry.
    }
  }

  let balanceSol = 0;
  let orders: unknown[] = [];
  if (user) {
    const overview = await getWalletOverview(user.id);
    balanceSol = overview.balanceSol ?? 0;
    orders = await listOwnerBoosts(user.id);
  }

  return NextResponse.json({
    ready,
    payTo: ready ? cfg.boostWallet.trim() : "",
    packages: publicPackages(cfg),
    active: await getActiveBoosts(),
    orders,
    balanceSol,
    signedIn: Boolean(user),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to buy a boost." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const tokenAddress = String(body.tokenAddress ?? "").trim();
  const tier = Number(body.tier);
  if (!tokenAddress) {
    return NextResponse.json({ error: "Token address required." }, { status: 400 });
  }
  if (!tier) {
    return NextResponse.json({ error: "Choose a boost package." }, { status: 400 });
  }
  const result = await createBoostOrder(user.id, tokenAddress, tier);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
