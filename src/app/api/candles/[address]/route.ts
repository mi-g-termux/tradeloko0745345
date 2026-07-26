// GET /api/candles/:address?tf=hour&aggregate=1&limit=200
// Real OHLCV candles (GeckoTerminal, free). :address is the token address;
// we resolve its best pair, then fetch that pool's candles.
import { NextRequest, NextResponse } from "next/server";
import { getCandles, type Timeframe } from "@/lib/data/candles";
import { getTokenSummary } from "@/lib/data/dexscreener";
import { guardPublicRoute } from "@/lib/security/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { address: string } },
) {
  // These endpoints spend paid upstream quota (Helius/Birdeye/Gemini),
  // so an unauthenticated scraper could run up the bill or exhaust it.
  const limited = await guardPublicRoute(req, "candles", 120, 60);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const tf = (searchParams.get("tf") as Timeframe) || "hour";
  const aggregate = Number(searchParams.get("aggregate") ?? 1);
  const limit = Number(searchParams.get("limit") ?? 200);
  try {
    const token = await getTokenSummary(params.address);
    if (!token?.pairAddress) {
      return NextResponse.json({ candles: [], error: "No pair found" });
    }
    const candles = await getCandles(token.pairAddress, tf, aggregate, limit);
    return NextResponse.json({ candles, pairAddress: token.pairAddress });
  } catch (err) {
    return NextResponse.json(
      { candles: [], error: (err as Error).message },
      { status: 502 },
    );
  }
}
