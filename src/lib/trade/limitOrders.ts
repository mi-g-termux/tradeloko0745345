// Limit / take-profit / stop-loss keeper (feature #7). Users create orders with
// a trigger price; a cron polls live prices and executes when triggered.
import { getServiceClient } from "../supabase";
import { getAdminConfig } from "../adminConfig";
import { getTokenSummary } from "../data/dexscreener";
// Routed through the ownership router: an order created by a user executes
// from THAT user's custodial wallet under their own caps. Only orders with no
// owner_id reach the server hot wallet.
import { routedBuy, routedSellAll } from "./route";

export interface KeeperResult {
  open: number; triggered: number; filled: number; failed: number; note?: string;
}

function isTriggered(triggerType: string, triggerPrice: number, price: number): boolean {
  if (triggerType === "price_below") return price <= triggerPrice;
  if (triggerType === "price_above") return price >= triggerPrice;
  return false;
}

export async function runKeeper(): Promise<KeeperResult> {
  const cfg = await getAdminConfig();
  if (!cfg.keeperEnabled) return { open: 0, triggered: 0, filled: 0, failed: 0, note: "Keeper disabled." };
  const db = getServiceClient();
  if (!db) return { open: 0, triggered: 0, filled: 0, failed: 0, note: "No database." };

  const { data: orders } = await db.from("limit_orders").select("*").eq("status", "open").limit(100);
  if (!orders || orders.length === 0) return { open: 0, triggered: 0, filled: 0, failed: 0 };

  let triggered = 0, filled = 0, failed = 0;
  for (const o of orders) {
    const t = await getTokenSummary(o.token_address).catch(() => null);
    if (!t || t.priceUsd == null) continue;
    if (!isTriggered(o.trigger_type, Number(o.trigger_price), t.priceUsd)) continue;
    triggered++;
    // A sell triggered ABOVE the entry is a take-profit; BELOW is a stop-loss.
    const sellReason =
      o.trigger_type === "price_above" ? "take-profit" : "stop-loss";
    const exec = o.side === "buy"
      ? await routedBuy({
          tokenAddress: o.token_address,
          amountSol: Number(o.amount_sol ?? cfg.maxBuySol),
          source: "keeper",
          ownerId: o.owner_id ?? null,
          reason: "limit buy",
        })
      : await routedSellAll(o.token_address, {
          ownerId: o.owner_id ?? null,
          reason: sellReason,
          symbol: o.symbol ?? null,
        });
    if (exec.ok) {
      filled++;
      await db.from("limit_orders").update({ status: "filled", tx_signature: exec.signature ?? null, executed_at: new Date().toISOString() }).eq("id", o.id);
    } else {
      failed++;
      await db.from("limit_orders").update({ status: "failed", error: exec.error ?? "unknown" }).eq("id", o.id);
    }
  }
  return { open: orders.length, triggered, filled, failed };
}
