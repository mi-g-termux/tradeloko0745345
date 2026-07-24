// Feature registry (onboarding). Drives the welcome screen + /features page so a
// user landing on the site immediately sees EVERY capability and whether it's
// live, needs an API key, or is toggled off by the admin. Single source of
// truth used by /api/features.
import { getAdminConfig } from "./adminConfig";
import type { FeatureInfo } from "./types";

type Status = "live" | "needs_key" | "off";

function gate(enabled: boolean, hasKey: boolean, keyRequired: boolean): Status {
  if (!enabled) return "off";
  if (keyRequired && !hasKey) return "needs_key";
  return "live";
}

export async function getFeatures(): Promise<FeatureInfo[]> {
  const cfg = await getAdminConfig();

  return [
    { key: "scanner", label: "Live token scanner", description: "Real-time trending Solana memecoins from DexScreener - price, liquidity, volume, momentum.", href: "/", status: "live" },
    { key: "search", label: "Token search", description: "Search any Solana token by name, symbol or mint address from the scanner bar.", href: "/", status: "live" },
    { key: "launches", label: "New launch radar", description: "Freshly-created tokens (incl. pump.fun) with an instant safety pre-screen and a live websocket feed.", href: "/launches", status: "live" },
    { key: "safety", label: "Rug / safety analysis", description: "On-chain mint authority, freeze authority, holder concentration, liquidity depth - a 0-100 risk score.", href: "/", status: "live" },
    { key: "holders", label: "Top holders + PnL", description: "See a token's biggest wallets, their share of supply, USD value, and an estimated profit/loss per holder.", href: "/", status: "live" },
    { key: "signals", label: "Signal engine + history", description: "Technicals, chart patterns, safety and social fused into a directional call with entry & invalidation. Outcomes are tracked for a real hit-rate.", href: "/signals", status: "live" },
    { key: "ai", label: "AI analysis (Gemini)", description: "Optional Google Gemini second opinion on chart structure. Admin-toggled.", href: "/signals", status: gate(cfg.aiEnabled, Boolean(cfg.geminiApiKey), true), note: "Needs a free Gemini API key." },
    { key: "xfeed", label: "X / Twitter sentiment", description: "Folds cashtag mention volume + sentiment into the signal score. Admin-toggled.", href: "/signals", status: gate(cfg.xFeedEnabled, Boolean(cfg.xBearerToken), true), note: "Needs an X API bearer token." },
    { key: "autoscan", label: "Auto-scanner + alerts", description: "Scans on a schedule, keeps the strongest safe signals, and pushes them to Telegram.", href: "/signals", status: cfg.autoScanEnabled ? "live" : "off" },
    { key: "telegram", label: "Telegram alerts", description: "Global broadcast + personal watchlist alerts to your own chat. Admin-toggled.", href: "/account", status: gate(cfg.telegramAlertsEnabled, Boolean(cfg.telegramBotToken && cfg.telegramChatId), true), note: "Needs a Telegram bot token + chat id." },
    { key: "whales", label: "Whale tracking", description: "Real on-chain buy/sell activity for wallets you track (via Helius). Admin-toggled.", href: "/whales", status: gate(cfg.whaleTrackingEnabled, Boolean(cfg.heliusApiKey), true), note: "Needs a free Helius API key." },
    { key: "copytrade", label: "Copy-trade automation", description: "Mirror buys from copy-enabled tracked wallets - gated by the same safety + spend rails.", href: "/whales", status: cfg.copyTradeEnabled ? (cfg.autoBuyEnabled ? "live" : "needs_key") : "off", note: "Requires auto-buy + signer key to actually purchase." },
    { key: "portfolio", label: "Portfolio & PnL", description: "Live wallet holdings priced in real time, with known cost basis from your buys.", href: "/portfolio", status: "live" },
    { key: "buy", label: "1-click buy (Jupiter)", description: "Non-custodial swaps signed by your own wallet - the same router BullX/Photon use.", href: "/", status: "live" },
    { key: "autobuy", label: "Auto-buy", description: "Server-signed buys behind per-trade + daily spend caps and a mandatory safety score. Admin-toggled.", href: "/admin", status: cfg.autoBuyEnabled ? "live" : "off", note: "Requires a funded signer hot wallet." },
    { key: "orders", label: "Limit / TP / SL orders", description: "Set trigger prices; the keeper executes buys and take-profit/stop-loss sells automatically.", href: "/orders", status: cfg.keeperEnabled ? "live" : "off" },
    { key: "auth", label: "Login (wallet or Telegram)", description: "Sign in with your Solana wallet (SIWS) or Telegram to save watchlists, orders and alerts.", href: "/account", status: "live" },
  ];
}
