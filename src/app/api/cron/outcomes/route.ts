// GET/POST /api/cron/outcomes — backfill 1h/24h signal outcomes so the
// hit-rate stats stay honest. Run every 30 minutes.
import { backfillOutcomes } from "@/lib/analysis/outcomes";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("outcomes", req, async () => {
    const result = await backfillOutcomes();
    return { status: "ok" as const, result };
  });
}
export const POST = GET;
