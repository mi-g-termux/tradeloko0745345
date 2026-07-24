// Vercel Cron / external cron -> whale-buy signal sweep. Watches the admin
// smart-money wallet list and fires Telegram signals when a whale buys a token
// that also passes the signal gate. Secured by CRON_SECRET (Bearer header or
// ?key= query param, matching the other cron routes).
import { NextResponse } from "next/server";
import { runWhaleSignals } from "@/lib/analysis/whaleSignals";
import { SERVER_ENV } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = SERVER_ENV.cronSecret;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  const key = new URL(req.url).searchParams.get("key");
  return key === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runWhaleSignals();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}

export const POST = GET;
