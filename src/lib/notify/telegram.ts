// Telegram alerts — ported from the Quotex telegram-broadcaster, rebuilt for
// memecoin signals. Uses the real Telegram Bot API. Broadcasts are gated behind
// the admin toggle + bot token + chat id. Per-user alerts (feature #5) go to
// each user's saved chat id. If config is missing it no-ops (never throws).
import { getAdminConfig } from "../adminConfig";
import { getServiceClient } from "../supabase";
import type { TradeSignal } from "../types";

/** Low-level send to a specific chat id using a specific bot token. */
async function sendTo(
  botToken: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  if (!botToken || !chatId) return false;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Send to the global broadcast chat (admin-configured). */
async function send(text: string): Promise<boolean> {
  const cfg = await getAdminConfig();
  if (!cfg.telegramAlertsEnabled) return false;
  return sendTo(cfg.telegramBotToken, cfg.telegramChatId, text);
}

function emoji(direction: string): string {
  return direction === "bullish" ? "🟢" : direction === "bearish" ? "🔴" : "⚪";
}

function signalText(s: TradeSignal): string {
  const lines = [
    `${emoji(s.direction)} <b>${s.symbol}</b> — ${s.direction.toUpperCase()} signal`,
    `Confidence: <b>${s.confidence}%</b>  (score ${s.score})`,
    s.safetyScore != null ? `Safety: ${s.safetyScore}/100` : "",
    s.suggestedEntry ? `Entry: ${s.suggestedEntry}` : "",
    s.invalidation ? `Invalidation: ${s.invalidation}` : "",
    s.ai ? `AI: ${s.ai.lean} (${s.ai.confidence}%) — ${s.ai.reasoning}` : "",
    "",
    `<code>${s.address}</code>`,
    "⚠ Signal, not a guarantee. Memecoins are extremely high risk.",
  ].filter(Boolean);
  return lines.join("\n");
}

/** Whether alerts are currently deliverable (for UI hints). */
export async function telegramReady(): Promise<{
  enabled: boolean;
  configured: boolean;
}> {
  const cfg = await getAdminConfig();
  return {
    enabled: cfg.telegramAlertsEnabled,
    configured: Boolean(cfg.telegramBotToken && cfg.telegramChatId),
  };
}

export async function broadcastSignal(s: TradeSignal): Promise<boolean> {
  return send(signalText(s));
}

export async function broadcastBuy(
  symbol: string,
  amountSol: number,
  signature: string,
  source: string,
): Promise<boolean> {
  return send(
    [
      `✅ <b>Buy executed</b> (${source})`,
      `${symbol} — ${amountSol} SOL`,
      `Tx: <code>${signature}</code>`,
    ].join("\n"),
  );
}

/**
 * Per-user watchlist alerts (feature #5). Notifies every user who watches this
 * token AND has alerts_enabled + a saved telegram_chat_id. Uses the admin bot
 * token to deliver. Returns how many users were notified.
 */
export async function notifyWatchers(s: TradeSignal): Promise<number> {
  const cfg = await getAdminConfig();
  if (!cfg.telegramBotToken) return 0;
  const db = getServiceClient();
  if (!db) return 0;

  const { data: watchers } = await db
    .from("watchlist")
    .select("owner_id")
    .eq("token_address", s.address);
  if (!watchers || watchers.length === 0) return 0;

  const ownerIds = [...new Set(watchers.map((w) => w.owner_id).filter(Boolean))];
  if (ownerIds.length === 0) return 0;

  const { data: users } = await db
    .from("app_users")
    .select("id, telegram_chat_id, alerts_enabled")
    .in("id", ownerIds);
  if (!users) return 0;

  let notified = 0;
  const text = `🔔 Watchlist alert\n${signalText(s)}`;
  for (const u of users) {
    if (!u.alerts_enabled || !u.telegram_chat_id) continue;
    const ok = await sendTo(cfg.telegramBotToken, u.telegram_chat_id, text);
    if (ok) notified++;
  }
  return notified;
}
