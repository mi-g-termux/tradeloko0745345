// User-defined price-condition alerts. Each alert stores a baseline price (the
// price when the user created it) and a target move: up (e.g. 2x => +100%) or
// down (e.g. -50%). A cron polls live prices; when the condition is met we email
// the owner. One-shot alerts auto-disable after firing; `repeat` alerts re-arm.
import { getServiceClient } from "../supabase";
import { getAdminConfig } from "../adminConfig";
import { getTokenSummary } from "../data/dexscreener";
import { notifyPriceAlert } from "./email";
import type { PriceAlert } from "../types";

export interface PriceAlertsResult {
  checked: number;
  triggered: number;
  emailed: number;
  note?: string;
}

function rowToAlert(r: Record<string, any>): PriceAlert {
  return {
    id: r.id,
    tokenAddress: r.token_address,
    symbol: r.symbol ?? null,
    direction: r.direction,
    pct: Number(r.pct),
    label: r.label ?? null,
    baselinePrice: r.baseline_price != null ? Number(r.baseline_price) : null,
    enabled: Boolean(r.enabled),
    repeat: Boolean(r.repeat),
    lastPrice: r.last_price != null ? Number(r.last_price) : null,
    triggeredAt: r.triggered_at ?? null,
    createdAt: r.created_at,
  };
}

/** Has the move from baseline reached the target in the alert's direction? */
function conditionMet(alert: PriceAlert, price: number): boolean {
  if (alert.baselinePrice == null || alert.baselinePrice <= 0) return false;
  const changePct = ((price - alert.baselinePrice) / alert.baselinePrice) * 100;
  if (alert.direction === "up") return changePct >= alert.pct;
  return changePct <= -Math.abs(alert.pct);
}

export function changePct(alert: PriceAlert, price: number): number {
  if (alert.baselinePrice == null || alert.baselinePrice <= 0) return 0;
  return ((price - alert.baselinePrice) / alert.baselinePrice) * 100;
}

export async function runPriceAlerts(): Promise<PriceAlertsResult> {
  const cfg = await getAdminConfig();
  if (!cfg.emailNotificationsEnabled)
    return { checked: 0, triggered: 0, emailed: 0, note: "Email notifications disabled." };

  const db = getServiceClient();
  if (!db) return { checked: 0, triggered: 0, emailed: 0, note: "No database." };

  const { data: rows } = await db
    .from("price_alerts")
    .select("*")
    .eq("enabled", true)
    .limit(500);
  if (!rows || rows.length === 0) return { checked: 0, triggered: 0, emailed: 0 };

  // Price cache so multiple alerts on one token cost a single lookup.
  const priceCache = new Map<string, number | null>();
  async function priceOf(addr: string): Promise<number | null> {
    if (priceCache.has(addr)) return priceCache.get(addr) ?? null;
    const t = await getTokenSummary(addr).catch(() => null);
    const p = t?.priceUsd ?? null;
    priceCache.set(addr, p);
    return p;
  }

  let triggered = 0;
  let emailed = 0;
  for (const r of rows) {
    const alert = rowToAlert(r);
    const price = await priceOf(alert.tokenAddress);
    if (price == null) continue;

    if (!conditionMet(alert, price)) {
      await db.from("price_alerts").update({ last_price: price }).eq("id", alert.id);
      continue;
    }

    triggered++;
    const ok = r.owner_id
      ? await notifyPriceAlert(r.owner_id, alert, price, changePct(alert, price))
      : false;
    if (ok) emailed++;

    await db
      .from("price_alerts")
      .update({
        last_price: price,
        triggered_at: new Date().toISOString(),
        // One-shot alerts switch off so the user isn't spammed; repeat re-arms.
        enabled: alert.repeat ? true : false,
        // Re-arm repeat alerts against the new price as the fresh baseline.
        baseline_price: alert.repeat ? price : alert.baselinePrice,
      })
      .eq("id", alert.id);
  }

  return { checked: rows.length, triggered, emailed };
}
