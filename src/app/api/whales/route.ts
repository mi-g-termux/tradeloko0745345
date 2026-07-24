// GET /api/whales?wallet=ADDRESS -> recent swap activity for a wallet
// POST /api/whales  { address, label } -> track a wallet (requires login)
import { NextRequest, NextResponse } from "next/server";
import { getWalletActivity } from "@/lib/data/whales";
import { getCurrentUser } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim();
  if (!wallet) {
    // Return the caller's tracked wallets merged, if logged in.
    const user = await getCurrentUser();
    const db = getServiceClient();
    if (!user || !db) return NextResponse.json({ results: [] });
    const { data } = await db
      .from("tracked_wallets")
      .select("address, label")
      .eq("owner_id", user.id);
    const tracked = data ?? [];
    const all = await Promise.all(
      tracked.map((w) => getWalletActivity(w.address, w.label ?? undefined)),
    );
    const merged = all.flatMap((r) => r.activity);
    merged.sort((a, b) => b.timestamp - a.timestamp);
    return NextResponse.json({
      results: merged,
      needsKey: all.some((r) => r.needsKey),
      enabled: all.some((r) => r.enabled),
    });
  }
  const result = await getWalletActivity(wallet);
  return NextResponse.json({
    results: result.activity,
    needsKey: result.needsKey,
    enabled: result.enabled,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 503 });
  const { address, label } = await req.json();
  if (!address) return NextResponse.json({ error: "Missing address" }, { status: 400 });
  await db
    .from("tracked_wallets")
    .upsert(
      { owner_id: user.id, address, label: label ?? null },
      { onConflict: "owner_id,address" },
    );
  return NextResponse.json({ ok: true });
}
