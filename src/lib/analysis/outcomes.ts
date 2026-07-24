// Signal outcome tracking (feature #3). Stores price at signal time; crons
// backfill 1h/24h prices and compute % return, powering a REAL hit-rate.
// Also drives automatic Telegram "pump" follow-ups when an alerted token climbs.
import { getServiceClient } from "../supabase";
import { getTokenSummary } from "../data/dexscreener";
import { broadcastSignalPump } from "../notify/telegram";

export interface OutcomeResult { checked1h: number; checked24h: number; }

function pctReturn(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

export async function backfillOutcomes(): Promise<OutcomeResult> {
  const db = getServiceClient();
  if (!db) return { checked1h: 0, checked24h: 0 };

  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  let checked1h = 0;
  let checked24h = 0;

  const { data: due1h } = await db
    .from("signals").select("id, token_address, price_at_signal")
    .is("price_1h", null).not("price_at_signal", "is", null)
    .lte("created_at", oneHourAgo).limit(50);
  for (const s of due1h ?? []) {
    const t = await getTokenSummary(s.token_address).catch(() => null);
    if (!t || t.priceUsd == null) continue;
    await db.from("signals").update({
      price_1h: t.priceUsd,
      return_1h: pctReturn(Number(s.price_at_signal), t.priceUsd),
      outcome_checked_at: new Date().toISOString(),
    }).eq("id", s.id);
    checked1h++;
  }

  const { data: due24h } = await db
    .from("signals").select("id, token_address, price_at_signal")
    .is("price_24h", null).not("price_at_signal", "is", null)
    .lte("created_at", oneDayAgo).limit(50);
  for (const s of due24h ?? []) {
    const t = await getTokenSummary(s.token_address).catch(() => null);
    if (!t || t.priceUsd == null) continue;
    await db.from("signals").update({
      price_24h: t.priceUsd,
      return_24h: pctReturn(Number(s.price_at_signal), t.priceUsd),
      outcome_checked_at: new Date().toISOString(),
    }).eq("id", s.id);
    checked24h++;
  }
  return { checked1h, checked24h };
}

// Milestones (multiples of the signal price) that trigger a Telegram follow-up.
const PUMP_MILESTONES = [1.5, 2, 3, 5, 10];

export interface PumpUpdateResult { updated: number; }

/**
 * For each recently-alerted bullish signal, check the live price and, if the
 * token has crossed a new multiple milestone since the last update, post an
 * automatic "up Nx" follow-up to Telegram (global + watchers) with the current
 * price and market cap. Milestone progress is stored so we never double-notify.
 */
export async function broadcastSignalPumps(): Promise<PumpUpdateResult> {
  const db = getServiceClient();
  if (!db) return { updated: 0 };

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db
    .from("signals")
    .select("id, token_address, symbol, price_at_signal, last_alert_multiple")
    .eq("alerted", true)
    .eq("direction", "bullish")
    .not("price_at_signal", "is", null)
    .gte("created_at", since)
    .limit(100);

  let updated = 0;
  for (const s of rows ?? []) {
    const base = Number(s.price_at_signal);
    if (!base) continue;
    const t = await getTokenSummary(s.token_address).catch(() => null);
    if (!t || t.priceUsd == null) continue;
    const mult = t.priceUsd / base;
    const last = Number(s.last_alert_multiple ?? 1);
    const hit = PUMP_MILESTONES.filter((m) => mult >= m && m > last).pop();
    if (!hit) continue;
    await broadcastSignalPump(
      s.symbol ?? "?",
      s.token_address,
      hit,
      t.priceUsd,
      t.marketCap ?? t.fdv,
    ).catch(() => false);
    await db.from("signals").update({ last_alert_multiple: hit }).eq("id", s.id);
    updated++;
  }
  return { updated };
}

export interface SignalStats {
  total: number; resolved24h: number; wins24h: number;
  winRate24h: number | null; avgReturn24h: number | null;
}

export async function getSignalStats(): Promise<SignalStats> {
  const db = getServiceClient();
  if (!db) return { total: 0, resolved24h: 0, wins24h: 0, winRate24h: null, avgReturn24h: null };

  const { count: total } = await db.from("signals").select("id", { count: "exact", head: true });
  const { data: resolved } = await db
    .from("signals").select("return_24h").eq("direction", "bullish")
    .not("return_24h", "is", null).limit(1000);

  const rows = resolved ?? [];
  const wins = rows.filter((r) => Number(r.return_24h) > 0).length;
  const avg = rows.length > 0 ? rows.reduce((s, r) => s + Number(r.return_24h), 0) / rows.length : null;
  return {
    total: total ?? 0,
    resolved24h: rows.length,
    wins24h: wins,
    winRate24h: rows.length > 0 ? (wins / rows.length) * 100 : null,
    avgReturn24h: avg,
  };
}
