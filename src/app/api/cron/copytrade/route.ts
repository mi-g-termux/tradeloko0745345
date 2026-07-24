// Vercel Cron -> copy-trade sweep (feature #2). Secured by CRON_SECRET.
import { NextResponse } from "next/server";
import { runCopyTrade } from "@/lib/analysis/copytrade";
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
    const result = await runCopyTrade();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
