// POST /api/wallet/trade  { tokenAddress: string, side: "buy"|"sell", amountSol?: number }
// Custodial trade signed by the user's in-app wallet. Open to any signed-in user.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  buyWithUserWallet,
  sellAllWithUserWallet,
} from "@/lib/trade/custodialTrade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const tokenAddress = String(body.tokenAddress ?? "").trim();
  const side = body.side === "sell" ? "sell" : "buy";
  if (!tokenAddress) {
    return NextResponse.json({ error: "Token address required." }, { status: 400 });
  }

  if (side === "sell") {
    const result = await sellAllWithUserWallet(user.id, tokenAddress);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  const amountSol = Number(body.amountSol);
  if (!amountSol || amountSol <= 0) {
    return NextResponse.json({ error: "Amount must be greater than 0." }, { status: 400 });
  }
  const result = await buyWithUserWallet(user.id, tokenAddress, amountSol);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
