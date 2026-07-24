// Holder-concentration trend over time (feature #6). A cron records snapshots;
// the token page can show whether the top-10 grip is loosening or tightening.
import { getServiceClient } from "../supabase";
import { getHolderConcentration } from "../solana/rpc";

export interface HolderSnapshot {
  topHolderPct: number | null; top10Pct: number | null; createdAt: string;
}

export async function snapshotHolders(tokenAddress: string): Promise<boolean> {
  const db = getServiceClient();
  if (!db) return false;
  const h = await getHolderConcentration(tokenAddress).catch(() => null);
  if (!h) return false;
  await db.from("holder_snapshots").insert({
    token_address: tokenAddress,
    top_holder_pct: h.topHolderPct,
    top10_pct: h.top10Pct,
  });
  return true;
}

export async function getHolderTrend(tokenAddress: string, limit = 30): Promise<HolderSnapshot[]> {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("holder_snapshots").select("top_holder_pct, top10_pct, created_at")
    .eq("token_address", tokenAddress).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({
    topHolderPct: r.top_holder_pct != null ? Number(r.top_holder_pct) : null,
    top10Pct: r.top10_pct != null ? Number(r.top10_pct) : null,
    createdAt: r.created_at,
  })).reverse();
}
