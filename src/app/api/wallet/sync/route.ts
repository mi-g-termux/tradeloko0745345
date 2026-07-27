// POST /api/wallet/sync - reconcile THIS user's wallet history with the chain.
//
// Called by the wallet page on load, so a deposit that landed seconds ago is
// visible immediately rather than waiting for the next cron tick.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { syncWalletHistory } from "@/lib/wallet/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const result = await syncWalletHistory(user.id);
  return NextResponse.json({ ok: true, ...result });
}
