// Central runtime configuration.
// Server-side secrets are read from env and/or the admin_config table;
// nothing secret is ever shipped to the browser.

export const PUBLIC_ENV = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  telegramBotUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "",
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "MemePump",
};

export const SERVER_ENV = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatIdEnv: process.env.TELEGRAM_CHAT_ID ?? "",
  bootstrapAdminWallet: process.env.BOOTSTRAP_ADMIN_WALLET ?? "",
  // Break-glass admin recovery. If you lose access to the owner wallet, sign in
  // with ANY method (Telegram, or a new wallet), open /recover and enter this
  // value to promote that account to owner. Kept in the hosting dashboard
  // (Vercel env vars), which you control independently of any wallet.
  // Unset = the recovery route is disabled entirely and returns 404-style errors.
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
  // Master key that encrypts custodial wallet secret keys at rest (AES-256-GCM).
  // Set a 64-char hex string. If unset, in-app wallets are disabled.
  walletMasterKey: process.env.WALLET_MASTER_KEY ?? "",
  // Secret that authorizes the scheduled scan endpoint (Vercel Cron).
  cronSecret: process.env.CRON_SECRET ?? "",
  // Default public RPC works with no key but is heavily rate-limited.
  defaultRpcUrl:
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  heliusKeyEnv: process.env.HELIUS_API_KEY ?? "",
  birdeyeKeyEnv: process.env.BIRDEYE_API_KEY ?? "",
  xBearerEnv: process.env.X_BEARER_TOKEN ?? "",
  geminiKeyEnv: process.env.GEMINI_API_KEY ?? "",
  // --- Email (SMTP) env fallbacks; admin panel settings override these. ---
  appUrl:
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : ""),
  smtpHostEnv: process.env.SMTP_HOST ?? "",
  smtpPortEnv: process.env.SMTP_PORT ?? "",
  smtpUserEnv: process.env.SMTP_USER ?? "",
  smtpPassEnv: process.env.SMTP_PASS ?? "",
  smtpFromEnv: process.env.SMTP_FROM ?? "",
  smtpSecureEnv: process.env.SMTP_SECURE ?? "",
};

// Public API bases (all free / no key required).
export const DEXSCREENER_BASE = "https://api.dexscreener.com";
export const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6";
export const JUPITER_TOKEN_API = "https://tokens.jup.ag";

// GeckoTerminal — FREE OHLCV candle data for Solana pools (no key required).
export const GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2";
// Google Gemini — optional AI analysis (admin-toggled, needs key).
export const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta";
// X / Twitter API v2 — optional social feed (admin-toggled, needs paid bearer).
export const TWITTER_API_BASE = "https://api.twitter.com/2";

// Wrapped SOL mint — used as the input for buy swaps.
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export function hasSupabase(): boolean {
  return Boolean(SERVER_ENV.supabaseUrl && SERVER_ENV.supabaseServiceKey);
}

/** Absolute base URL used for links inside emails (localhost in dev). */
export function appBaseUrl(): string {
  return SERVER_ENV.appUrl || "http://localhost:3000";
}

/**
 * Absolute base URL, but ONLY when it is publicly reachable.
 *
 * `appBaseUrl()` falls back to http://localhost:3000 so local dev links still
 * render. That fallback is poison for anything a *third party* clicks: a
 * Telegram button pointing at localhost opens the reader's own machine and
 * appears broken. Use this helper for outbound links and omit the link when it
 * returns "".
 */
export function publicBaseUrl(): string {
  const raw = (SERVER_ENV.appUrl || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.endsWith(".local") ||
    !host.includes(".")
  ) {
    return "";
  }
  return u.origin + (u.pathname === "/" ? "" : u.pathname);
}
