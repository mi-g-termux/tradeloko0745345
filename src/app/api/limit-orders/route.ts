// Limit / TP / SL orders (feature #7).
import { NextResponse } from "next/server";
import { requireRole, getCurrentUser } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const { data } = await db.from("limit_orders").select("*").eq("owner_id", user.id).order("created_at", { ascending: false });
  return NextResponse.json({ orders: data ?? [] });
}

export async function POST(req: Request) {
  let user;
  try { user = await requireRole("trader"); }
  catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 403 }); }
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const side = b.side === "sell" ? "sell" : "buy";
  const triggerType = b.triggerType === "price_above" ? "price_above" : "price_below";
  const triggerPrice = Number(b.triggerPrice);
  const tokenAddress = String(b.tokenAddress ?? "").trim();
  if (!tokenAddress || !triggerPrice || triggerPrice <= 0) {
    return NextResponse.json({ error: "tokenAddress and positive triggerPrice required" }, { status: 400 });
  }
  await db.from("limit_orders").insert({
    owner_id: user.id, token_address: tokenAddress, symbol: b.symbol ?? null,
    side, trigger_type: triggerType, trigger_price: triggerPrice,
    amount_sol: side === "buy" ? Number(b.amountSol ?? 0) || null : null, status: "open",
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.from("limit_orders").update({ status: "cancelled" }).eq("id", id).eq("owner_id", user.id).eq("status", "open");
  return NextResponse.json({ ok: true });
}
