// GET/POST /api/cron/boost-expire - retire finished boosts.
//
// Run hourly on cron-job.org. Ranking already ignores boosts whose expiry has
// passed, so this is bookkeeping: it keeps the admin's order list honest.
import { expireBoosts } from "@/lib/boost/boosts";
import { getServiceClient } from "@/lib/supabase";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("boost-expire", req, async () => {
    const db = getServiceClient();
    if (!db) {
      return { status: "skipped" as const, reason: "Supabase is not configured." };
    }
    const expired = await expireBoosts();
    return { status: "ok" as const, result: { expired } };
  });
}
export const POST = GET;
