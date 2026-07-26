// GET/POST /api/cron/whale-signals — turns smart-money buys into analysed
// signals. Run every 10 minutes.
import { runWhaleSignals } from "@/lib/analysis/whaleSignals";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("whale-signals", req, async () => {
    const result = await runWhaleSignals();
    return { status: "ok" as const, result };
  });
}
export const POST = GET;
