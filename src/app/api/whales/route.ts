// GET /api/whales?wallet=ADDRESS -> recent swap activity for a wallet
// POST /api/whales  { address, label } -> track a wallet (requires login)
// Activity rows are enriched with the token's symbol/name and current market cap
// so the tracker reads like Photon (what was bought/sold + at what size).
import { NextRequest, NextResponse } from "next/server";
import { getWalletActivity } from "@/lib/data/whales";
import { getTokenSummary } from "@/lib/data/dexscreener";
import { getCurrentUser } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";
import type { WalletActivity } from "@/lib/types";

export const dynamic = "force-dynamic";

// Attach live token metadata (symbol, name, price, market cap) to each row.
async function enrich(list: WalletActivity[]): Promise<WalletActivity[]> {
  const addrs = [...new Set(list.map((a) => a.tokenAddress).filter(Boolean))];
  const map = new Map<string, Awaited<ReturnType<typeof getTokenSummary>>>();
  await Promise.all(
    addrs.map(async (a) => {
      try {
        map.set(a, await getTokenSummary(a));
      } catch {
        map.set(a, null);
      }
    }),
  );
  return list.map((a) => {
    const s = map.get(a.tokenAddress);
    if (!s) return a;
    return {
      ...a,
      tokenSymbol: s.symbol,
      tokenName: s.name,
      marketCap: s.marketCap ?? s.fdv,
      priceUsd: s.priceUsd,
    };
  });
}

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
      results: await enrich(merged.slice(0, 60)),
      needsKey: all.some((r) => r.needsKey),
      enabled: all.some((r) => r.enabled),
    });
  }
  const result = await getWalletActivity(wallet);
  return NextResponse.json({
    results: await enrich(result.activity),
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
