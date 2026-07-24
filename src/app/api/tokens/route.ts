// GET /api/tokens?sort=volume|gainers|new&q=search
// Real Solana market data from DexScreener (free, no key).
import { NextRequest, NextResponse } from "next/server";
import { scanTrending, searchTokens, type ScanSort } from "@/lib/data/dexscreener";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const sort = (searchParams.get("sort") as ScanSort) || "volume";
  try {
    const tokens = q ? await searchTokens(q) : await scanTrending(sort);
    return NextResponse.json({ tokens });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, tokens: [] },
      { status: 502 },
    );
  }
}
