// GET /api/admin/cron -> scheduler health + copy-paste cron-job.org schedule.
// Admin only. This is what makes "are my signals actually running?" answerable
// instead of guesswork.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { CRON_JOBS, getCronStatus } from "@/lib/cron/runner";
import { SERVER_ENV, baseUrlFromRequest } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Cron expression for a cadence expressed in minutes. */
function cronExpression(everyMinutes: number): string {
  if (everyMinutes < 60) return `*/${everyMinutes} * * * *`;
  const hours = Math.round(everyMinutes / 60);
  return hours <= 1 ? "0 * * * *" : `0 */${hours} * * *`;
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // Derive the base from the request the admin is making right now, so the
  // copyable URLs always point at the domain they are actually browsing --
  // Vercel, cPanel, Render or a custom domain -- with no env var required.
  // Trailing slash would produce //api/cron/... in the copyable URLs.
  const base = (baseUrlFromRequest(req) || "").replace(/\/+$/, "");

  let jobs: Awaited<ReturnType<typeof getCronStatus>> = [];
  let statusError: string | null = null;
  try {
    jobs = await getCronStatus();
  } catch (e) {
    // Most likely the v2 migration (cron_runs table) has not been run yet.
    statusError = (e as Error).message;
  }

  return NextResponse.json({
    cronSecretConfigured: Boolean(SERVER_ENV.cronSecret),
    baseUrl: base,
    statusError,
    jobs,
    schedule: CRON_JOBS.map((j) => ({
      job: j.job,
      label: j.label,
      description: j.description,
      everyMinutes: j.everyMinutes,
      url: `${base}${j.path}`,
      cronExpression: cronExpression(j.everyMinutes),
    })),
  });
}
