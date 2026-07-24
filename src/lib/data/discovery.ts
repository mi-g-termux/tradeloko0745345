// Admin-pinned tokens + "most searched" tracking. Uses the token_searches table
// when a database is configured; degrades gracefully to no-ops otherwise.
import { getServiceClient } from "../supabase";
import type { TokenSummary } from "../types";
import { getTokenSummary } from "./dexscreener";

// Parse the admin textarea: one mint per line (an optional label is ignored).
export function parsePinned(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const addr = line.trim().split(/[\s,|]+/)[0];
    if (addr && !seen.has(addr)) {
      seen.add(addr);
      out.push(addr);
    }
  }
  return out;
}

// Resolve admin-pinned mint addresses into full token rows (max 10).
export async function getPinnedTokens(
  raw: string | null | undefined,
): Promise<TokenSummary[]> {
  const addrs = parsePinned(raw).slice(0, 10);
  if (addrs.length === 0) return [];
  const settled = await Promise.allSettled(addrs.map((a) => getTokenSummary(a)));
  const out: TokenSummary[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) out.push(r.value);
  }
  return out;
}

// Count a search hit against the token the search resolved to.
export async function recordSearch(
  query: string,
  top: TokenSummary | undefined,
): Promise<void> {
  const db = getServiceClient();
  if (!db || !top) return;
  const { data: existing } = await db
    .from("token_searches")
    .select("hits")
    .eq("address", top.address)
    .maybeSingle();
  const hits = (existing?.hits ?? 0) + 1;
  await db.from("token_searches").upsert(
    {
      address: top.address,
      symbol: top.symbol,
      name: top.name,
      hits,
      last_query: query,
      last_at: new Date().toISOString(),
    },
    { onConflict: "address" },
  );
}

// The most-searched tokens, hydrated with live market data.
export async function getMostSearched(limit = 30): Promise<TokenSummary[]> {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("token_searches")
    .select("address")
    .order("hits", { ascending: false })
    .limit(limit);
  const addrs = (data ?? []).map((r) => r.address).filter(Boolean);
  if (addrs.length === 0) return [];
  const settled = await Promise.allSettled(addrs.map((a) => getTokenSummary(a)));
  const out: TokenSummary[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) out.push(r.value);
  }
  return out;
}
