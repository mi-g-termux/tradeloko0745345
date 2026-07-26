// GET/POST /api/cron/keeper — limit / take-profit / stop-loss keeper.
// Run every 5 minutes.
import { runKeeper } from "@/lib/trade/limitOrders";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("keeper", req, async () => {
    const result = await runKeeper();
    return { status: "ok" as const, result };
  });
}
export const POST = GET;
