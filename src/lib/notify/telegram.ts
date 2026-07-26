// Telegram alerts — real Telegram Bot API.
//
// Buy-button behaviour (the thing that was broken):
//   * The old keyboard's "Trade" button used appBaseUrl(), which silently falls
//     back to http://localhost:3000. That renders as a button but resolves to
//     the *reader's own device*, so it did nothing. Now every URL is validated
//     by isTelegramSafeUrl() and dropped if it isn't publicly reachable.
//   * It also linked pump.fun for every token, which 404s for tokens that
//     didn't launch there. Replaced with a real, admin-selected buy route
//     (Jupiter by default) that works for any SPL mint.
//   * Telegram trading-bot deeplinks don't work on Telegram Desktop, so a web
//     buy link is always included alongside them.
//   * The buy link is ALSO written into the message body as an HTML anchor, so
//     the alert stays actionable even if the inline keyboard is rejected.
//   * sendTo() now surfaces Telegram's error description instead of swallowing
//     it, and retries once without the keyboard so a bad button can never
//     silently kill the whole alert.
import { getAdminConfig, type AdminConfig } from "../adminConfig";
import { getServiceClient } from "../supabase";
import {
  buildBuyLinks,
  primaryBuyLink,
  dexscreenerUrl,
  isTelegramSafeUrl,
  type BuyLink,
} from "./buyLinks";
import { publicBaseUrl } from "../config";
import type { TradeSignal } from "../types";

type InlineKeyboard = {
  inline_keyboard: Array<Array<Record<string, unknown>>>;
};

const TG_API = "https://api.telegram.org/bot";

/** Low-level send to a specific chat id using a specific bot token. */
async function sendTo(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<boolean> {
  if (!botToken || !chatId) return false;
  const url = TG_API + botToken + "/sendMessage";

  const post = async (markup?: InlineKeyboard) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(markup ? { reply_markup: markup } : {}),
      }),
    });
    let description = "";
    try {
      const body = (await res.json()) as { ok?: boolean; description?: string };
      description = body?.description ?? "";
    } catch {
      description = "";
    }
    return { ok: res.ok, description };
  };

  try {
    const first = await post(replyMarkup);
    if (first.ok) return true;

    console.error(
      "[telegram] sendMessage failed:",
      first.description || "(no description)",
    );

    // A rejected button must not cost us the whole alert. The message body
    // already carries the buy link as a plain anchor.
    if (replyMarkup) {
      const retry = await post(undefined);
      if (retry.ok) {
        console.error(
          "[telegram] delivered without inline keyboard; check button URLs",
        );
        return true;
      }
      console.error(
        "[telegram] retry without keyboard also failed:",
        retry.description || "(no description)",
      );
    }
    return false;
  } catch (e) {
    console.error("[telegram] sendMessage threw:", (e as Error).message);
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

/**
 * Security notice to the broadcast chat.
 *
 * Deliberately does NOT check `telegramAlertsEnabled`: that switch governs
 * trading noise, and silencing a "someone just took ownership of your site"
 * warning because market alerts were turned off would be a security hole.
 * Still a no-op when no bot token / chat id is configured.
 */
export async function sendAdminAlert(text: string): Promise<boolean> {
  const cfg = await getAdminConfig();
  return sendTo(cfg.telegramBotToken, cfg.telegramChatId, text);
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

function anchor(label: string, url: string): string {
  return '<a href="' + url + '">' + label + "</a>";
}

/**
 * Quick-action buttons. Every URL is validated, so an unreachable destination
 * produces no button rather than a dead one.
 */
function tokenButtons(address: string, cfg: AdminConfig): InlineKeyboard {
  const rows: Array<Array<Record<string, unknown>>> = [];
  const buys = buildBuyLinks(address, cfg);

  // Row 1: the buy routes (at most two side by side).
  const buyRow = buys
    .slice(0, 2)
    .map((l: BuyLink) => ({ text: l.label, url: l.url }));
  if (buyRow.length) rows.push(buyRow);

  // Row 2: chart + this site's token page, when the site has a public URL.
  const row2: Array<Record<string, unknown>> = [
    { text: "📈 Chart", url: dexscreenerUrl(address) },
  ];
  const base = publicBaseUrl();
  if (base) {
    const appUrl = base + "/token/" + address;
    if (isTelegramSafeUrl(appUrl)) {
      row2.push({ text: "📊 Full analysis", url: appUrl });
    }
  }
  rows.push(row2.filter((b) => isTelegramSafeUrl(String(b.url))));

  // Row 3: tap-to-copy contract address.
  rows.push([{ text: "📋 Copy CA", copy_text: { text: address } }]);

  return { inline_keyboard: rows.filter((r) => r.length > 0) };
}

function signalText(s: TradeSignal, cfg: AdminConfig): string {
  const buys = buildBuyLinks(s.address, cfg);
  const primary = primaryBuyLink(buys);

  const lines = [
    `${emoji(s.direction)} <b>$${s.symbol}</b> — ${s.direction.toUpperCase()} signal`,
    "━━━━━━━━━━━━━",
    `💰 Price: <b>${usdCompact(s.priceUsd)}</b>`,
    `📊 Market cap: <b>${usdCompact(s.marketCap)}</b>`,
    `🎯 Confidence: <b>${s.confidence}%</b> (score ${s.score})`,
    s.safetyScore != null ? `🛡 Safety: ${s.safetyScore}/100` : "",
    "",
    s.suggestedEntry ? `📥 <b>Buy zone:</b> ${s.suggestedEntry}` : "",
    s.targets && s.targets.length
      ? `🎯 <b>Targets:</b> ${s.targets.join("  •  ")}`
      : "",
    s.stopLoss ? `🛑 <b>Stop:</b> ${s.stopLoss}` : "",
    s.invalidation ? `⚠ ${s.invalidation}` : "",
    s.ai ? `\n🤖 AI: ${s.ai.lean} (${s.ai.confidence}%) — ${s.ai.reasoning}` : "",
    "",
    // Plain-text buy link: survives clients that strip inline keyboards, and
    // works on Telegram Desktop where bot deeplinks do not.
    primary ? `👉 ${anchor("Buy " + s.symbol + " now", primary.url)}` : "",
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

/**
 * Preview of what the buy button will point at, for the admin panel. Lets an
 * admin see the exact URL before broadcasting instead of discovering it's dead.
 */
export async function buyButtonPreview(sampleMint: string): Promise<{
  route: string;
  links: BuyLink[];
  appUrlConfigured: boolean;
}> {
  const cfg = await getAdminConfig();
  return {
    route: cfg.tgBuyRoute,
    links: buildBuyLinks(sampleMint, cfg),
    appUrlConfigured: Boolean(publicBaseUrl()),
  };
}

export async function broadcastSignal(s: TradeSignal): Promise<boolean> {
  const cfg = await getAdminConfig();
  return send(signalText(s, cfg), tokenButtons(s.address, cfg));
}

export async function broadcastWhaleBuy(
  label: string,
  s: TradeSignal,
  amountSol?: number,
): Promise<boolean> {
  const cfg = await getAdminConfig();
  const size = amountSol ? ` (~${amountSol.toFixed(2)} SOL)` : "";
  const head = `🐋 <b>Whale buy</b> — ${label} just aped <b>$${s.symbol}</b>${size}\n\n`;
  return send(head + signalText(s, cfg), tokenButtons(s.address, cfg));
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
  const cfg = await getAdminConfig();
  const buys = buildBuyLinks(address, cfg);
  const primary = primaryBuyLink(buys);
  const text = [
    `🚀 <b>$${symbol}</b> is up <b>${multiple}x</b> since the signal!`,
    "━━━━━━━━━━━━━",
    `💰 Price: <b>${usdCompact(priceUsd)}</b>`,
    `📊 Market cap: <b>${usdCompact(marketCap)}</b>`,
    "",
    "Consider taking some profit. 💸",
    primary ? `\n👉 ${anchor("Trade " + symbol, primary.url)}` : "",
    "",
    "Contract (tap to copy):",
    `<code>${address}</code>`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  const kb = tokenButtons(address, cfg);
  const ok = await send(text, kb);
  await notifyWatchersText(address, text, kb);
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
    const ok = await sendTo(
      cfg.telegramBotToken,
      u.telegram_chat_id,
      text,
      replyMarkup,
    );
    if (ok) notified++;
  }
  return notified;
}

/**
 * Per-user watchlist alerts. Notifies every user who watches this token AND has
 * alerts_enabled + a saved telegram_chat_id. Returns how many were notified.
 */
export async function notifyWatchers(s: TradeSignal): Promise<number> {
  const cfg = await getAdminConfig();
  return notifyWatchersText(
    s.address,
    `🔔 Watchlist alert\n${signalText(s, cfg)}`,
    tokenButtons(s.address, cfg),
  );
}
