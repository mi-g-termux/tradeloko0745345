// POST /api/boost/pay  { orderId: string }
// One-click purchase paid from the buyer's own in-app wallet balance.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { payBoostFromWallet } from "@/lib/boost/boosts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to buy a boost." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId ?? "").trim();
  if (!orderId) {
    return NextResponse.json({ error: "Order id required." }, { status: 400 });
  }
  const result = await payBoostFromWallet(user.id, orderId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
