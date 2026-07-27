// GET/POST /api/cron/wallet-sync - reconcile every custodial wallet with the
// chain so deposits show up without the user having to open the wallet page.
//
// Run this every 5 minutes on cron-job.org. It is cheap: one signature list per
// wallet, and full transactions are only fetched for signatures never seen.
import { syncAllWallets } from "@/lib/wallet/sync";
import { getServiceClient } from "@/lib/supabase";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("wallet-sync", req, async () => {
    const db = getServiceClient();
    if (!db) {
      return {
        status: "skipped" as const,
        reason: "Supabase is not configured.",
      };
    }
    const result = await syncAllWallets();
    return { status: "ok" as const, result };
  });
}
export const POST = GET;
