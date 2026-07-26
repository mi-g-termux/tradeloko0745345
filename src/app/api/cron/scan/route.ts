// GET/POST /api/cron/scan — the scheduled auto-scanner.
// This is the job that makes signals arrive on a REGULAR interval. Run it every
// 15 minutes from cron-job.org (or Vercel Cron) with:
//   Authorization: Bearer $CRON_SECRET
// Auth, timing and heartbeat logging all live in lib/cron/runner.
import { NextRequest } from "next/server";
import { scanAndAlert } from "@/lib/analysis/scanner";
import { getAdminConfig } from "@/lib/adminConfig";
import { runCronJob } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest) {
  return runCronJob("scan", req, async () => {
    const cfg = await getAdminConfig();
    if (!cfg.autoScanEnabled) {
      return {
        status: "skipped" as const,
        reason: "Auto-scan is turned OFF in Admin → Automation.",
      };
    }
    const result = await scanAndAlert();
    return { status: "ok" as const, result };
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
