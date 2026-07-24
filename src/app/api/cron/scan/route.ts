// GET/POST /api/cron/scan  — scheduled auto-scanner (Vercel Cron).
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. We also accept
// `?key=CRON_SECRET` for manual curl testing. If CRON_SECRET is unset, the
// endpoint refuses (so it can't be abused before you configure it).
import { NextRequest, NextResponse } from "next/server";
import { scanAndAlert } from "@/lib/analysis/scanner";
import { getAdminConfig } from "@/lib/adminConfig";
import { SERVER_ENV } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = SERVER_ENV.cronSecret;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const key = new URL(req.url).searchParams.get("key");
  return key === secret;
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cfg = await getAdminConfig();
  if (!cfg.autoScanEnabled) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Auto-scan is disabled in admin settings.",
    });
  }
  const result = await scanAndAlert();
  return NextResponse.json({ ok: true, result });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
