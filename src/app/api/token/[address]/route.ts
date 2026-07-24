// GET /api/token/:address  -> token summary + all pairs
import { NextRequest, NextResponse } from "next/server";
import { getTokenSummary, getPairsForToken } from "@/lib/data/dexscreener";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } },
) {
  try {
    const [summary, pairs] = await Promise.all([
      getTokenSummary(params.address),
      getPairsForToken(params.address),
    ]);
    if (!summary) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
    return NextResponse.json({ summary, pairs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
