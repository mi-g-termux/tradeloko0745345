// Auto-scanner — the memecoin equivalent of the Quotex bot loop.
// Scans trending Solana tokens, builds full signals, keeps the strong ones,
// de-dupes against recently-alerted tokens, records them (with entry price for
// outcome tracking), broadcasts the best to Telegram, and pings watchlist
// users. Designed to be called on a schedule (Vercel Cron) or manually by an
// admin. All data is real; nothing is faked.
import { scanTrending } from "../data/dexscreener";
import { buildSignal } from "./signal";
import { broadcastSignal, notifyWatchers } from "../notify/telegram";
import { getAdminConfig } from "../adminConfig";
import { getServiceClient } from "../supabase";
import type { TradeSignal } from "../types";

export interface ScanResult {
  scanned: number;
  qualified: number;
  alerted: number;
  watchersNotified: number;
  skippedRecent: number;
  top: Array<{
    address: string;
    symbol: string;
    direction: string;
    confidence: number;
  }>;
  note?: string;
}

// Don't re-alert the same token within this window.
const DEDUPE_HOURS = 6;
// Cap how many tokens we deep-analyze per run (rate-limit friendliness).
const MAX_ANALYZE = 12;
// Cap how many alerts we actually send per run (avoid spamming Telegram).
const MAX_ALERTS = 5;

export async function scanAndAlert(): Promise<ScanResult> {
  const cfg = await getAdminConfig();
  const candidates = await scanTrending("volume", MAX_ANALYZE);

  // Analyze all candidates in PARALLEL and skip the slow AI/social calls so
  // the whole run finishes well under the cron timeout.
  const settled = await Promise.allSettled(
    candidates.map((t) => buildSignal(t.address, { skipAi: true, skipSocial: true })),
  );
  const qualified: TradeSignal[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const sig = r.value;
    if (
      sig.direction === "bullish" &&
      sig.confidence >= cfg.minSignalConfidence &&
      (sig.safetyScore == null || sig.safetyScore >= cfg.requireSafeScore)
    ) {
      qualified.push(sig);
    }
  }

  qualified.sort((a, b) => b.confidence - a.confidence);

  const db = getServiceClient();
  let alerted = 0;
  let skippedRecent = 0;
  let watchersNotified = 0;

  for (const sig of qualified) {
    if (alerted >= MAX_ALERTS) break;

    // De-dupe: skip if we alerted this token recently.
    if (db) {
      const since = new Date(
        Date.now() - DEDUPE_HOURS * 3600 * 1000,
      ).toISOString();
      const { data: recent } = await db
        .from("signals")
        .select("id")
        .eq("token_address", sig.address)
        .eq("alerted", true)
        .gte("created_at", since)
        .limit(1);
      if (recent && recent.length > 0) {
        skippedRecent++;
        continue;
      }
    }

    const sent = await broadcastSignal(sig).catch(() => false);
    if (sent) alerted++;

    // Per-user watchlist alerts (feature #5).
    watchersNotified += await notifyWatchers(sig).catch(() => 0);

    if (db) {
      await db
        .from("signals")
        .insert({
          token_address: sig.address,
          symbol: sig.symbol,
          direction: sig.direction,
          confidence: sig.confidence,
          score: sig.score,
          data: sig,
          alerted: sent,
          price_at_signal: sig.priceUsd,
        })
        .then(() => undefined, () => undefined);
    }
  }

  return {
    scanned: candidates.length,
    qualified: qualified.length,
    alerted,
    watchersNotified,
    skippedRecent,
    top: qualified.slice(0, 10).map((s) => ({
      address: s.address,
      symbol: s.symbol,
      direction: s.direction,
      confidence: s.confidence,
    })),
    note:
      alerted === 0 && qualified.length > 0
        ? "Qualified signals found but Telegram alerts are off/unconfigured or all were recently alerted."
        : undefined,
  };
}
