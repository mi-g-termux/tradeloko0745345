// GET /api/launches — newest Solana tokens with a light safety pre-screen.
import { NextResponse } from "next/server";
import { getRecentLaunches } from "@/lib/data/launches";
import { rateLimit, clientIp } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!rateLimit(`launches:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  const { searchParams } = new URL(req.url);
  const limit = Math.min(50, Number(searchParams.get("limit") ?? 30) || 30);
  try {
    const launches = await getRecentLaunches(limit);
    return NextResponse.json({ launches });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
