// GET/POST /api/cron/signal-updates — follow-up alerts (2x/3x/5x/10x) on
// signals that already fired. Run every 15 minutes.
//
// SECURITY FIX: this route previously returned `true` from its auth check when
// CRON_SECRET was unset, leaving it publicly triggerable. The shared runner
// always denies when no secret is configured.
import { broadcastSignalPumps } from "@/lib/analysis/outcomes";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob("signal-updates", req, async () => {
    const result = await broadcastSignalPumps();
    return { status: "ok" as const, result };
  });
}
export const POST = GET;
