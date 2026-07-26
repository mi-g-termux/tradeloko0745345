// GET/POST /api/cron/holders — snapshot holder concentration for watchlisted
// tokens so the safety module can show a real trend. Run hourly.
import { snapshotHolders } from "@/lib/data/holderTrend";
import { getServiceClient } from "@/lib/supabase";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("holders", req, async () => {
    const db = getServiceClient();
    if (!db) {
      return {
        status: "skipped" as const,
        reason: "Supabase is not configured.",
      };
    }
    const { data } = await db.from("watchlist").select("token_address").limit(40);
    const tokens = [...new Set((data ?? []).map((r) => r.token_address))];
    let snapshotted = 0;
    for (const t of tokens) {
      if (await snapshotHolders(t).catch(() => false)) snapshotted++;
    }
    return {
      status: "ok" as const,
      result: { snapshotted, tokens: tokens.length },
    };
  });
}
export const POST = GET;
