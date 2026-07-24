// Telegram alerts — real Telegram Bot API. Broadcasts are gated behind the admin
// toggle + bot token + chat id. Per-user alerts go to each user's saved chat id.
// Signal messages include price, market cap, a buy zone, take-profit targets, a
// stop level, a tap-to-copy contract address, and quick Trade/Chart buttons.
// Auto follow-up "pump" updates fire when an alerted token climbs (2x/3x/...).
import { getAdminConfig } from "../adminConfig";
import { getServiceClient } from "../supabase";
import { appBaseUrl } from "../config";
import type { TradeSignal } from "../types";

type InlineKeyboard = {
  inline_keyboard: Array<Array<Record<string, unknown>>>;
};

/** Low-level send to a specific chat id using a specific bot token. */
async function sendTo(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup?: InlineKeyboard,
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
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Send to the global broadcast chat (admin-configured). */
async function send(
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<boolean> {
  const cfg = await getAdminConfig();
  if (!cfg.telegramAlertsEnabled) return false;
  return sendTo(cfg.telegramBotToken, cfg.telegramChatId, text, replyMarkup);
}

function emoji(direction: string): string {
  return direction === "bullish" ? "🟢" : direction === "bearish" ? "🔴" : "⚪";
}

function usdCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
}

/** Quick-action buttons: trade on the app, chart, pump.fun, copy CA. */
function tokenButtons(address: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "⚡ Trade", url: `${appBaseUrl()}/token/${address}` },
        { text: "📈 Chart", url: `https://dexscreener.com/solana/${address}` },
      ],
      [
        { text: "🔗 Pump.fun", url: `https://pump.fun/${address}` },
        { text: "📋 Copy CA", copy_text: { text: address } },
      ],
    ],
  };
}

function signalText(s: TradeSignal): string {
  const lines = [
    `${emoji(s.direction)} <b>$${s.symbol}</b> — ${s.direction.toUpperCase()} signal`,
    "━━━━━━━━━━━━━",
    `💰 Price: <b>${usdCompact(s.priceUsd)}</b>`,
    `📊 Market cap: <b>${usdCompact(s.marketCap)}</b>`,
    `🎯 Confidence: <b>${s.confidence}%</b> (score ${s.score})`,
    s.safetyScore != null ? `🛡 Safety: ${s.safetyScore}/100` : "",
    "",
    s.suggestedEntry ? `📥 <b>Buy:</b> ${s.suggestedEntry}` : "",
    s.targets && s.targets.length
      ? `🎯 <b>Targets:</b> ${s.targets.join("  •  ")}`
      : "",
    s.stopLoss ? `🛑 <b>Stop:</b> ${s.stopLoss}` : "",
    s.invalidation ? `⚠ ${s.invalidation}` : "",
    s.ai ? `\n🤖 AI: ${s.ai.lean} (${s.ai.confidence}%) — ${s.ai.reasoning}` : "",
    "",
    "Contract (tap to copy):",
    `<code>${s.address}</code>`,
    "",
    "⚠ Signal, not a guarantee. Memecoins are extremely high risk.",
  ].filter((l) => l !== "");
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
  return send(signalText(s), tokenButtons(s.address));
}

export async function broadcastWhaleBuy(
  label: string,
  s: TradeSignal,
  amountSol?: number,
): Promise<boolean> {
  const size = amountSol ? ` (~${amountSol.toFixed(2)} SOL)` : "";
  const head = `🐋 <b>Whale buy</b> — ${label} just aped <b>$${s.symbol}</b>${size}

`;
  return send(head + signalText(s), tokenButtons(s.address));
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

/** Auto follow-up when an alerted token climbs (2x/3x/...). */
export async function broadcastSignalPump(
  symbol: string,
  address: string,
  multiple: number,
  priceUsd: number | null,
  marketCap: number | null,
): Promise<boolean> {
  const text = [
    `🚀 <b>$${symbol}</b> is up <b>${multiple}x</b> since the signal!`,
    "━━━━━━━━━━━━━",
    `💰 Price: <b>${usdCompact(priceUsd)}</b>`,
    `📊 Market cap: <b>${usdCompact(marketCap)}</b>`,
    "",
    "Consider taking some profit. 💸",
    "",
    "Contract (tap to copy):",
    `<code>${address}</code>`,
  ].join("\n");
  const ok = await send(text, tokenButtons(address));
  await notifyWatchersText(address, text, tokenButtons(address));
  return ok;
}

async function notifyWatchersText(
  address: string,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<number> {
  const cfg = await getAdminConfig();
  if (!cfg.telegramBotToken) return 0;
  const db = getServiceClient();
  if (!db) return 0;

  const { data: watchers } = await db
    .from("watchlist")
    .select("owner_id")
    .eq("token_address", address);
  if (!watchers || watchers.length === 0) return 0;

  const ownerIds = [...new Set(watchers.map((w) => w.owner_id).filter(Boolean))];
  if (ownerIds.length === 0) return 0;

  const { data: users } = await db
    .from("app_users")
    .select("id, telegram_chat_id, alerts_enabled")
    .in("id", ownerIds);
  if (!users) return 0;

  let notified = 0;
  for (const u of users) {
    if (!u.alerts_enabled || !u.telegram_chat_id) continue;
    const ok = await sendTo(cfg.telegramBotToken, u.telegram_chat_id, text, replyMarkup);
    if (ok) notified++;
  }
  return notified;
}

/**
 * Per-user watchlist alerts. Notifies every user who watches this token AND has
 * alerts_enabled + a saved telegram_chat_id. Returns how many were notified.
 */
export async function notifyWatchers(s: TradeSignal): Promise<number> {
  return notifyWatchersText(
    s.address,
    `🔔 Watchlist alert\n${signalText(s)}`,
    tokenButtons(s.address),
  );
}
