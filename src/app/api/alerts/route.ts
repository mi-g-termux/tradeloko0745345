// User-facing CRUD for price-condition alerts (feature: notify me when a token
// I care about goes up 2x / down X%). All scoped to the signed-in user.
//   GET    -> list my alerts
//   POST   -> create an alert (captures baseline price now)
//   PATCH  -> toggle enabled / repeat  { id, enabled?, repeat? }
//   DELETE -> remove an alert          ?id=... (or { id })
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";
import { getTokenSummary } from "@/lib/data/dexscreener";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const { data } = await db
    .from("price_alerts")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  return NextResponse.json({ alerts: data ?? [] });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const tokenAddress = String(body.tokenAddress ?? "").trim();
  const direction = body.direction === "down" ? "down" : "up";
  const pct = Number(body.pct);
  if (!tokenAddress) return NextResponse.json({ error: "Token address required" }, { status: 400 });
  if (!pct || pct <= 0) return NextResponse.json({ error: "Percent must be greater than 0" }, { status: 400 });

  // Capture the current price as the baseline the move is measured against.
  const token = await getTokenSummary(tokenAddress).catch(() => null);
  const baseline = token?.priceUsd ?? null;
  const symbol = token?.symbol ?? null;
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim()
      : direction === "up"
        ? pct === 100
          ? "2x"
          : `up ${pct}%`
        : `down ${pct}%`;

  const { data, error } = await db
    .from("price_alerts")
    .insert({
      owner_id: user.id,
      token_address: tokenAddress,
      symbol,
      direction,
      pct,
      label,
      baseline_price: baseline,
      enabled: true,
      repeat: Boolean(body.repeat),
    })
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, alert: data });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const update: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.repeat === "boolean") update.repeat = body.repeat;
  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  await db.from("price_alerts").update(update).eq("id", id).eq("owner_id", user.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const url = new URL(req.url);
  let id = url.searchParams.get("id") ?? "";
  if (!id) {
    const body = await req.json().catch(() => ({}));
    id = String(body.id ?? "");
  }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.from("price_alerts").delete().eq("id", id).eq("owner_id", user.id);
  return NextResponse.json({ ok: true });
}
