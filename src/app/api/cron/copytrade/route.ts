// GET/POST /api/cron/copytrade — copy-trade sweep. Run every 10 minutes.
import { runCopyTrade } from "@/lib/analysis/copytrade";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("copytrade", req, async () => {
    const result = await runCopyTrade();
    return { status: "ok" as const, result };
  });
}
export const POST = GET;
