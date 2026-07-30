// GET/POST /api/cron/boost-watch - credit boosts paid from external wallets.
//
// Run this every 5 minutes on cron-job.org. It watches the boost payout wallet
// for incoming SOL and activates the matching pending order automatically, so a
// token team that just sends the money never has to paste a signature.
//
// It costs nothing when nobody is waiting: with no pending orders it returns
// before making a single RPC call.
import { autoVerifyPendingBoosts } from "@/lib/boost/boosts";
import { getServiceClient } from "@/lib/supabase";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("boost-watch", req, async () => {
    const db = getServiceClient();
    if (!db) {
      return { status: "skipped" as const, reason: "Supabase is not configured." };
    }
    const result = await autoVerifyPendingBoosts();
    return { status: "ok" as const, result };
  });
}
export const POST = GET;
