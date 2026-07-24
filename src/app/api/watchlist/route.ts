// Per-user token watchlist (drives personal Telegram alerts).
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const { data } = await db
    .from("watchlist").select("token_address, note, created_at")
    .eq("owner_id", user.id).order("created_at", { ascending: false });
  return NextResponse.json({ watchlist: data ?? [] });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const tokenAddress = String(body.tokenAddress ?? "").trim();
  if (!tokenAddress) return NextResponse.json({ error: "tokenAddress required" }, { status: 400 });
  await db.from("watchlist").upsert({ owner_id: user.id, token_address: tokenAddress, note: body.note ?? null }, { onConflict: "owner_id,token_address" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const token = new URL(req.url).searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  await db.from("watchlist").delete().eq("owner_id", user.id).eq("token_address", token);
  return NextResponse.json({ ok: true });
}
