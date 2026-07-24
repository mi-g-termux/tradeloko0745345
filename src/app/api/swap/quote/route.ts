// POST /api/swap/quote  { outputMint, solAmount }
// Returns a real Jupiter quote (free). Used to preview a buy.
import { NextRequest, NextResponse } from "next/server";
import { getBuyQuote } from "@/lib/solana/jupiter";
import { getAdminConfig } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { outputMint, solAmount } = await req.json();
  if (!outputMint || !solAmount) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const cfg = await getAdminConfig();
  try {
    const quote = await getBuyQuote(outputMint, Number(solAmount), cfg.slippageBps);
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
