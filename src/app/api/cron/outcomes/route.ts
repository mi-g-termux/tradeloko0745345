// GET/POST /api/cron/outcomes — backfill 1h/24h signal outcomes so the
// hit-rate stats stay honest. Run every 30 minutes.
import { backfillOutcomes } from "@/lib/analysis/outcomes";
import { runCronJob } from "@/lib/cron/runner";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("outcomes", req, async () => {
    const result = await backfillOutcomes();

    // Piggy-back housekeeping so no extra cron-job.org entry is needed:
    // trims rate_hits, expired sessions, and used one-time codes.
    let purged = false;
    const db = getServiceClient();
    if (db) {
      const { error } = await db.rpc("purge_security_rows");
      purged = !error;
    }

    return { status: "ok" as const, result: { ...result, purged } };
  });
}
export const POST = GET;
