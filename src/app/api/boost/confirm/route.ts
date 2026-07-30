// POST /api/boost/confirm  { orderId: string, signature: string }
// Activates a boost paid from an external wallet, after verifying on-chain that
// the payout address really received the full package price.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { confirmBoostBySignature } from "@/lib/boost/boosts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to buy a boost." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId ?? "").trim();
  const signature = String(body.signature ?? "").trim();
  if (!orderId || !signature) {
    return NextResponse.json(
      { error: "Order id and transaction signature are both required." },
      { status: 400 },
    );
  }
  const result = await confirmBoostBySignature(orderId, signature);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
