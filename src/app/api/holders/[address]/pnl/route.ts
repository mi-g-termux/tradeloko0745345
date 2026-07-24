// GET /api/holders/:address/pnl?wallet=<w>&amount=<tokens>
// Best-effort realized + unrealized PnL (in SOL) for one wallet in this token.
import { NextRequest, NextResponse } from "next/server";
import { getHolderTokenPnl } from "@/lib/solana/holders";
import { getTokenSummary } from "@/lib/data/dexscreener";
import { WSOL_MINT } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { address: string } },
) {
  try {
    const wallet = req.nextUrl.searchParams.get("wallet");
    if (!wallet) {
      return NextResponse.json({ error: "wallet is required" }, { status: 400 });
    }
    const amountStr = req.nextUrl.searchParams.get("amount");
    const amount = amountStr != null ? Number(amountStr) : null;

    // Convert current holdings to SOL for the unrealized leg.
    let currentValueSol: number | null = null;
    if (amount != null && amount > 0) {
      const [tok, sol] = await Promise.all([
        getTokenSummary(params.address).catch(() => null),
        getTokenSummary(WSOL_MINT).catch(() => null),
      ]);
      const priceUsd = tok?.priceUsd ?? null;
      const solUsd = sol?.priceUsd ?? null;
      if (priceUsd != null && solUsd != null && solUsd > 0) {
        currentValueSol = (amount * priceUsd) / solUsd;
      }
    }

    const pnl = await getHolderTokenPnl(wallet, params.address, currentValueSol);
    return NextResponse.json({ pnl });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
