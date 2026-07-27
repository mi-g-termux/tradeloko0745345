// Copy-trade automation (feature #2). Mirrors recent BUYS from copy-enabled
// tracked wallets through the SAME safety + signal + spend gate.
import { getServiceClient } from "../supabase";
import { getAdminConfig } from "../adminConfig";
import { getWalletActivity } from "../data/whales";
import { buildSignal } from "./signal";
// Routed through the ownership router: a copy rule on a wallet tracked by a
// user spends THAT user's custodial wallet under their own caps. Only rules
// with no owner_id reach the server hot wallet.
import { routedBuy } from "../trade/route";

export interface CopyResult {
  wallets: number; buysSeen: number; copied: number; skipped: number; note?: string;
}

const FRESH_MINUTES = 60;

export async function runCopyTrade(): Promise<CopyResult> {
  const cfg = await getAdminConfig();
  if (!cfg.copyTradeEnabled) return { wallets: 0, buysSeen: 0, copied: 0, skipped: 0, note: "Copy-trade disabled." };
  const db = getServiceClient();
  if (!db) return { wallets: 0, buysSeen: 0, copied: 0, skipped: 0, note: "No database." };

  const { data: wallets } = await db
    .from("tracked_wallets").select("owner_id, address, label, copy_enabled").eq("copy_enabled", true);
  if (!wallets || wallets.length === 0) return { wallets: 0, buysSeen: 0, copied: 0, skipped: 0, note: "No copy-enabled wallets." };

  const freshCutoff = Date.now() - FRESH_MINUTES * 60 * 1000;
  let buysSeen = 0, copied = 0, skipped = 0;

  for (const w of wallets) {
    const res = await getWalletActivity(w.address, w.label ?? undefined).catch(() => null);
    if (!res || !res.activity) continue;
    const buys = res.activity.filter((a) => a.action === "buy" && a.timestamp >= freshCutoff);
    for (const buy of buys) {
      buysSeen++;
      const { data: dupe } = await db.from("buy_orders").select("id").eq("source_ref", buy.signature).limit(1);
      if (dupe && dupe.length > 0) { skipped++; continue; }
      const sig = await buildSignal(buy.tokenAddress).catch(() => null);
      if (!sig || sig.direction !== "bullish" || sig.confidence < cfg.minSignalConfidence ||
        (sig.safetyScore != null && sig.safetyScore < cfg.requireSafeScore)) { skipped++; continue; }
      const amount = Math.min(cfg.maxBuySol, buy.amountSol ?? cfg.maxBuySol);
      const label = w.label ? w.label : `${w.address.slice(0, 4)}…${w.address.slice(-4)}`;
      const exec = await routedBuy({
        tokenAddress: buy.tokenAddress, amountSol: amount, source: "copy",
        sourceRef: buy.signature, ownerId: w.owner_id ?? null,
        reason: `copy of ${label}`,
      });
      if (exec.ok) copied++; else skipped++;
    }
  }
  return {
    wallets: wallets.length, buysSeen, copied, skipped,
    note: !cfg.autoBuyEnabled ? "Copy-trade evaluated signals but auto-buy is OFF, so nothing was purchased." : undefined,
  };
}
