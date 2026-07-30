// GET /api/holders/:address -> top holders (owner, % supply, USD value).
import { NextRequest, NextResponse } from "next/server";
import { getTopHolders } from "@/lib/solana/holders";
import { getTokenSummary } from "@/lib/data/dexscreener";
import { guardPublicRoute } from "@/lib/security/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { address: string } },
) {
  // These endpoints spend paid upstream quota (Helius/Birdeye/Gemini),
  // so an unauthenticated scraper could run up the bill or exhaust it.
  const limited = await guardPublicRoute(req, "holders", 60, 60);
  if (limited) return limited;

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
