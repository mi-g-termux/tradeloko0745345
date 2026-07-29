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

  const summary = await getTokenSummary(params.address).catch(() => null);
  const priceUsd = summary?.priceUsd ?? null;

  try {
    const result = await getTopHolders(params.address, priceUsd);
    if (!result) {
      return NextResponse.json({
        result: null,
        priceUsd,
        reason: "Could not read holders for this mint right now.",
      });
    }
    return NextResponse.json({ result, priceUsd });
  } catch (err) {
    // A throttled public RPC is a TEMPORARY upstream condition, not a failure of
    // this server. Returning 502 with the raw JSON-RPC body leaked text like
    // "429 Too Many Requests" straight into the UI. Answer 200 with a plain
    // reason so the tab renders an explanation instead of a red error.
    const raw = (err as Error).message ?? "";
    const throttled = /429|Too Many Requests|rate limit/i.test(raw);
    return NextResponse.json({
      result: null,
      priceUsd,
      reason: throttled
        ? "The public Solana RPC is rate-limiting holder lookups. Add a free Helius key in the admin panel to make this reliable."
        : "Holder data is temporarily unavailable for this token.",
    });
  }
}
