// GET /api/safety/:address -> rug/safety report (on-chain + market data)
import { NextRequest, NextResponse } from "next/server";
import { analyzeSafety } from "@/lib/data/safety";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } },
) {
  try {
    const report = await analyzeSafety(params.address);
    // Best-effort cache (ignored if Supabase not configured).
    const db = getServiceClient();
    if (db) {
      await db
        .from("safety_cache")
        .upsert({
          token_address: params.address,
          score: report.score,
          data: report,
          updated_at: new Date().toISOString(),
        })
        .then(() => undefined, () => undefined);
    }
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
