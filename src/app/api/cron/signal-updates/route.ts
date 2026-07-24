// Vercel Cron / external cron -> automatic Telegram follow-ups when alerted
// signals pump (2x/3x/5x/10x). Secured by CRON_SECRET.
import { NextResponse } from "next/server";
import { broadcastSignalPumps } from "@/lib/analysis/outcomes";
import { SERVER_ENV } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = SERVER_ENV.cronSecret;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await broadcastSignalPumps();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
