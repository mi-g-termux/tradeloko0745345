// GET/POST /api/cron/price-alerts — user price-condition alerts.
// Run every 5 minutes.
import { runPriceAlerts } from "@/lib/notify/priceAlerts";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("price-alerts", req, async () => {
    const result = await runPriceAlerts();
    return { status: "ok" as const, result };
  });
}
export const POST = GET;
