// Whale-buy signals. Watches an admin-curated list of "smart money" wallets and,
// when one of them BUYS a token, runs the full signal engine on that token. If
// the buy looks right (bullish + clears the confidence/safety gates) it fires a
// Telegram signal tagged with the whale. Requires whale tracking + a Helius key
// + Telegram alerts. Never invents data: no key means nothing is sent.
import { getServiceClient } from "../supabase";
import { getAdminConfig } from "../adminConfig";
import { getWalletActivity } from "../data/whales";
import { buildSignal } from "./signal";
import { broadcastWhaleBuy } from "../notify/telegram";

export interface WhaleSignalResult {
  wallets: number;
  buysSeen: number;
  alerted: number;
  skipped: number;
  note?: string;
}

export interface Whale {
  address: string;
  label?: string;
}

// How recent a buy must be to be considered (the cron runs every few minutes).
const FRESH_MINUTES = 30;

// Parse the admin textarea: one wallet per line, with an optional label after
// the address separated by whitespace, comma, or pipe.
export function parseWhaleWallets(raw: string | null | undefined): Whale[] {
  if (!raw) return [];
  const out: Whale[] = [];
  const seen = new Set<string>();
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace("\r", "").trim();
    if (!line) continue;
    const parts = line.split(/[\s,|]+/);
    const address = parts[0];
    if (!address || seen.has(address)) continue;
    seen.add(address);
    const label = parts.slice(1).join(" ").trim();
    out.push({ address, label: label || undefined });
  }
  return out;
}

export async function runWhaleSignals(): Promise<WhaleSignalResult> {
  const cfg = await getAdminConfig();
  if (!cfg.whaleTrackingEnabled) {
    return { wallets: 0, buysSeen: 0, alerted: 0, skipped: 0, note: "Whale tracking is off." };
  }
  const whales = parseWhaleWallets(cfg.whaleWallets);
  if (whales.length === 0) {
    return { wallets: 0, buysSeen: 0, alerted: 0, skipped: 0, note: "No whale wallets configured in the admin panel." };
  }
  if (!cfg.heliusApiKey) {
    return { wallets: whales.length, buysSeen: 0, alerted: 0, skipped: 0, note: "Add a Helius API key to read on-chain whale activity." };
  }

  const db = getServiceClient();
  const freshCutoff = Date.now() - FRESH_MINUTES * 60 * 1000;
  let buysSeen = 0;
  let alerted = 0;
  let skipped = 0;

  for (const w of whales) {
    const res = await getWalletActivity(w.address, w.label).catch(() => null);
    if (!res || !res.activity) continue;
    const buys = res.activity.filter(
      (a) => a.action === "buy" && a.timestamp >= freshCutoff,
    );
    for (const buy of buys) {
      buysSeen++;
      // Dedupe on the tx signature so each whale buy is only handled once.
      if (db) {
        const { data: dupe } = await db
          .from("whale_alerts")
          .select("signature")
          .eq("signature", buy.signature)
          .limit(1);
        if (dupe && dupe.length > 0) {
          skipped++;
          continue;
        }
      }
      const sig = await buildSignal(buy.tokenAddress).catch(() => null);
      const rightBuy =
        sig != null &&
        sig.direction === "bullish" &&
        sig.confidence >= cfg.minSignalConfidence &&
        (sig.safetyScore == null || sig.safetyScore >= cfg.requireSafeScore);
      if (rightBuy && sig) {
        const label = w.label
          ? w.label
          : `${w.address.slice(0, 4)}...${w.address.slice(-4)}`;
        await broadcastWhaleBuy(label, sig, buy.amountSol);
        alerted++;
      } else {
        skipped++;
      }
      // Record it either way so we never re-evaluate the same tx.
      if (db) {
        await db.from("whale_alerts").insert({
          signature: buy.signature,
          wallet: w.address,
          label: w.label ?? null,
          token_address: buy.tokenAddress,
        });
      }
    }
  }

  return { wallets: whales.length, buysSeen, alerted, skipped };
}
