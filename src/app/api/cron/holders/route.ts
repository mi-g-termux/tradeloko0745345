// Vercel Cron -> snapshot holder concentration for watchlisted tokens (feature #6).
import { NextResponse } from "next/server";
import { snapshotHolders } from "@/lib/data/holderTrend";
import { getServiceClient } from "@/lib/supabase";
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
  const db = getServiceClient();
  if (!db) return NextResponse.json({ ok: true, snapshotted: 0 });
  const { data } = await db.from("watchlist").select("token_address").limit(40);
  const tokens = [...new Set((data ?? []).map((r) => r.token_address))];
  let snapshotted = 0;
  for (const t of tokens) {
    if (await snapshotHolders(t).catch(() => false)) snapshotted++;
  }
  return NextResponse.json({ ok: true, snapshotted, tokens: tokens.length });
}
