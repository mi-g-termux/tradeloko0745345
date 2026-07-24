// POST /api/swap/build  { quote, userPublicKey }
// Returns an UNSIGNED swap transaction (base64) for the user's browser wallet
// to sign and send. This is the safe, non-custodial manual-buy path — the
// server never touches the user's private key.
import { NextRequest, NextResponse } from "next/server";
import { buildSwapTransaction } from "@/lib/solana/jupiter";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { quote, userPublicKey } = await req.json();
  if (!quote || !userPublicKey) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  try {
    const swapTransaction = await buildSwapTransaction(quote, userPublicKey);
    return NextResponse.json({ swapTransaction });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
