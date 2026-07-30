// GET /api/tokens?sort=trending|volume|gainers|new|searched&q=search
// Real Solana market data. Ordering for the Trending feed is OURS: tokens whose
// teams bought a boost on this site rank first (highest tier first), then the
// organic volume ranking. Admin-pinned tokens still ride above everything.
import { NextRequest, NextResponse } from "next/server";
import {
  scanTrending,
  searchTokens,
  type ScanSort,
} from "@/lib/data/dexscreener";
import { boostWeights } from "@/lib/boost/boosts";
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
    const base: TokenSummary[] = await scanTrending(
      sort === "trending" ? "volume" : sort,
    );
    const cfg = await getAdminConfig();
    const pinned = await getPinnedTokens(cfg.pinnedTokens);

    let boosted: TokenSummary[] = [];
    if (sort === "trending") {
      // Paid boosts sold on this site. A boosted token is surfaced even when it
      // is nowhere near the organic volume leaders - that is what was paid for -
      // and it is tagged so the UI can show the Boosted badge honestly.
      const weights = await boostWeights();
      const addresses = Object.keys(weights);
      if (addresses.length > 0) {
        const resolved = await getPinnedTokens(addresses.join(","));
        boosted = resolved
          .map((t) => ({ ...t, boosts: weights[t.address] ?? 1 }))
          .sort((a, b) => (b.boosts ?? 0) - (a.boosts ?? 0));
      }
    }

    const seen = new Set<string>();
    const tokens: TokenSummary[] = [];
    for (const t of [...pinned, ...boosted, ...base]) {
      if (seen.has(t.address)) continue;
      seen.add(t.address);
      tokens.push(t);
    }
    return NextResponse.json({ tokens });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, tokens: [] },
      { status: 502 },
    );
  }
}
