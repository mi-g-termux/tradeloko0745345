// GET /api/holders/:address -> top holders (owner, % supply, USD value).
import { NextRequest, NextResponse } from "next/server";
import { getTopHolders } from "@/lib/solana/holders";
import { getTokenSummary } from "@/lib/data/dexscreener";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } },
) {
  try {
    const summary = await getTokenSummary(params.address).catch(() => null);
    const priceUsd = summary?.priceUsd ?? null;
    const result = await getTopHolders(params.address, priceUsd);
    if (!result) {
      return NextResponse.json(
        { error: "Could not read holders (invalid mint or RPC unavailable)." },
        { status: 404 },
      );
    }
    return NextResponse.json({ result, priceUsd });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
