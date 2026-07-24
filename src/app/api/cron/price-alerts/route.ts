// Vercel Cron -> user price-condition alerts. Secured by CRON_SECRET.
// Polls live prices for every enabled alert and emails owners when their
// up/down condition is met. Runs every couple of minutes (see vercel.json).
import { NextResponse } from "next/server";
import { runPriceAlerts } from "@/lib/notify/priceAlerts";
import { SERVER_ENV } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = SERVER_ENV.cronSecret;
  if (!secret) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("key") === secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runPriceAlerts();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
