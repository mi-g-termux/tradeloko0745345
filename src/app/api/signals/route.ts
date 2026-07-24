// GET /api/signals — recent signal history + measured outcome stats (feature #3).
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getSignalStats } from "@/lib/analysis/outcomes";
import { rateLimit, clientIp } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!rateLimit(`signals:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  const db = getServiceClient();
  if (!db) return NextResponse.json({ signals: [], stats: null });
  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Number(searchParams.get("limit") ?? 50) || 50);
  const [{ data: signals }, stats] = await Promise.all([
    db.from("signals")
      .select("token_address, symbol, direction, confidence, score, alerted, price_at_signal, price_1h, price_24h, return_1h, return_24h, created_at")
      .order("created_at", { ascending: false }).limit(limit),
    getSignalStats(),
  ]);
  return NextResponse.json({ signals: signals ?? [], stats });
}
