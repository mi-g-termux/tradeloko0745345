// GET /api/tokens?sort=trending|volume|gainers|new|searched&q=search
// Real Solana market data from DexScreener (free, no key). Admin-pinned tokens
// always ride at the top; user searches are counted for the "Searched" tab.
import { NextRequest, NextResponse } from "next/server";
import {
  scanTrending,
  searchTokens,
  type ScanSort,
} from "@/lib/data/dexscreener";
import { getBoostedSolanaTokens } from "@/lib/data/dexBoosts";
import { getAdminConfig } from "@/lib/adminConfig";
import {
  recordSearch,
  getMostSearched,
  getPinnedTokens,
} from "@/lib/data/discovery";
import type { TokenSummary } from "@/lib/types";
import { guardPublicRoute } from "@/lib/security/rateLimit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  // These endpoints spend paid upstream quota (Helius/Birdeye/Gemini),
  // so an unauthenticated scraper could run up the bill or exhaust it.
  const limited = await guardPublicRoute(req, "tokens", 120, 60);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const sort = (searchParams.get("sort") as ScanSort) || "trending";
  try {
    if (q) {
      const tokens = await searchTokens(q);
      recordSearch(q, tokens[0]).catch(() => {});
      return NextResponse.json({ tokens });
    }
    if (sort === "searched") {
      return NextResponse.json({ tokens: await getMostSearched() });
    }
    let base: TokenSummary[];
    if (sort === "trending") {
      base = await getBoostedSolanaTokens();
      if (base.length === 0) base = await scanTrending("volume");
    } else {
      base = await scanTrending(sort);
    }
    const cfg = await getAdminConfig();
    const pinned = await getPinnedTokens(cfg.pinnedTokens);
    const seen = new Set(pinned.map((t) => t.address));
    const tokens = [...pinned, ...base.filter((t) => !seen.has(t.address))];
    return NextResponse.json({ tokens });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, tokens: [] },
      { status: 502 },
    );
  }
}
