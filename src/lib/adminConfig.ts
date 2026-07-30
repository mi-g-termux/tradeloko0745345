// Reads the single-row admin_config, merging in env fallbacks.
// Secrets returned here must stay server-side.
import { getServiceClient } from "./supabase";
import { SERVER_ENV } from "./config";

export interface AdminConfig {
  autoBuyEnabled: boolean;
  whaleTrackingEnabled: boolean;
  whaleWallets: string;
  pinnedTokens: string;
  feeEnabled: boolean;
  feePercent: number;
  feeWallet: string;
  xFeedEnabled: boolean;
  aiEnabled: boolean;
  /**
   * When on, every configured AI provider analyses the trade independently and
   * their verdicts are combined (an "AI council"). Disagreement lowers
   * confidence instead of being hidden, which is the point: one model
   * hallucinating a bullish case no longer moves a signal on its own.
   */
  aiCouncilEnabled: boolean;
  telegramAlertsEnabled: boolean;
  autoScanEnabled: boolean;
  copyTradeEnabled: boolean;
  launchFeedEnabled: boolean;
  keeperEnabled: boolean;
  emailNotificationsEnabled: boolean;
  heliusApiKey: string;
  birdeyeApiKey: string;
  xBearerToken: string;
  geminiApiKey: string;
  // ── Additional AI providers (all optional; any subset can be filled in) ──
  openaiApiKey: string;
  anthropicApiKey: string;
  groqApiKey: string;
  deepseekApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  rpcUrl: string;
  /**
   * Fallback RPC used when the primary returns 429/5xx. Free public endpoints
   * rate-limit aggressively, so one spare keeps holder reads working.
   */
  rpcUrlBackup: string;
  /**
   * Canonical public origin, e.g. https://memepumps.vercel.app or
   * https://yourdomain.com. This is what Telegram buttons and emails link to.
   * Set this when you move to a custom domain or cPanel; blank means "use
   * whatever hostname the request arrived on".
   */
  siteUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  /**
   * Display name shown in the recipient's inbox, e.g. "MemePump" so the sender
   * reads as `MemePump <alerts@yoursite.com>` instead of a bare address.
   * Blank falls back to the brand name.
   */
  smtpFromName: string;
  smtpSecure: boolean;
  maxBuySol: number;
  dailySpendCapSol: number;
  slippageBps: number;
  minLiquidityUsd: number;
  requireSafeScore: number;
  minSignalConfidence: number;
  // ── Branding (admin-managed, public-safe) ──
  brandName: string;
  logoUrl: string;
  faviconUrl: string;
  logoHeight: number;
  showBrandName: boolean;
  accentColor: string;
  // ── Ads ──
  adsEnabled: boolean;
  // ── Telegram buy button ──
  // Which buy route the signal's buy button points at, the referral code to
  // attach, and a template for routes we don't hardcode.
  tgBuyRoute: string;
  tgBuyRef: string;
  tgBuyTemplate: string;
  // Paid token boosts: our own promotion product, priced by the admin.
  // Boosts stay off sale until a payout wallet AND at least one priced
  // package exist - taking money with no destination would lose it.
  boostsEnabled: boolean;
  boostWallet: string;
  boostTier1Sol: number;
  boostTier1Hours: number;
  boostTier2Sol: number;
  boostTier2Hours: number;
  boostTier3Sol: number;
  boostTier3Hours: number;
}

const DEFAULTS: AdminConfig = {
  autoBuyEnabled: false,
  whaleTrackingEnabled: false,
  whaleWallets: "",
  pinnedTokens: "",
  feeEnabled: false,
  feePercent: 0.5,
  feeWallet: "",
  xFeedEnabled: false,
  aiEnabled: false,
  aiCouncilEnabled: false,
  telegramAlertsEnabled: false,
  autoScanEnabled: false,
  copyTradeEnabled: false,
  launchFeedEnabled: false,
  keeperEnabled: false,
  emailNotificationsEnabled: false,
  heliusApiKey: "",
  birdeyeApiKey: "",
  xBearerToken: "",
  geminiApiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  groqApiKey: "",
  deepseekApiKey: "",
  telegramBotToken: "",
  telegramChatId: "",
  rpcUrl: "",
  rpcUrlBackup: "",
  siteUrl: "",
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  smtpFromName: "",
  smtpSecure: false,
  maxBuySol: 0.1,
  dailySpendCapSol: 1.0,
  slippageBps: 100,
  minLiquidityUsd: 5000,
  requireSafeScore: 60,
  minSignalConfidence: 55,
  brandName: "",
  logoUrl: "",
  faviconUrl: "",
  logoHeight: 28,
  showBrandName: true,
  accentColor: "",
  adsEnabled: false,
  // Jupiter is the default because it needs no referral code, no bot setup and
  // works on every device for every SPL mint.
  tgBuyRoute: "jupiter",
  tgBuyRef: "",
  tgBuyTemplate: "",
  boostsEnabled: false,
  boostWallet: "",
  boostTier1Sol: 0.5,
  boostTier1Hours: 12,
  boostTier2Sol: 1.5,
  boostTier2Hours: 48,
  boostTier3Sol: 4,
  boostTier3Hours: 168,
};

let cache: { value: AdminConfig; expiry: number } | null = null;
const TTL_MS = 30_000;

export function invalidateAdminConfigCache(): void {
  cache = null;
}

export async function getAdminConfig(): Promise<AdminConfig> {
  if (cache && Date.now() < cache.expiry) return cache.value;

  const merged: AdminConfig = { ...DEFAULTS };
  let dbHasSmtpPort = false;
  let dbHasSmtpSecure = false;

  const db = getServiceClient();
  if (db) {
    const { data } = await db
      .from("admin_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (data) {
      merged.autoBuyEnabled = Boolean(data.auto_buy_enabled);
      merged.whaleTrackingEnabled = Boolean(data.whale_tracking_enabled);
      merged.whaleWallets = data.whale_wallets ?? "";
      merged.pinnedTokens = data.pinned_tokens ?? "";
      merged.feeEnabled = Boolean(data.fee_enabled);
      merged.feePercent = Number(data.fee_percent ?? DEFAULTS.feePercent);
      merged.feeWallet = data.fee_wallet ?? "";
      merged.xFeedEnabled = Boolean(data.x_feed_enabled);
      merged.aiEnabled = Boolean(data.ai_enabled);
      merged.aiCouncilEnabled = Boolean(data.ai_council_enabled);
      merged.telegramAlertsEnabled = Boolean(data.telegram_alerts_enabled);
      merged.autoScanEnabled = Boolean(data.auto_scan_enabled);
      merged.copyTradeEnabled = Boolean(data.copy_trade_enabled);
      merged.launchFeedEnabled = Boolean(data.launch_feed_enabled);
      merged.keeperEnabled = Boolean(data.keeper_enabled);
      merged.emailNotificationsEnabled = Boolean(
        data.email_notifications_enabled,
      );
      merged.heliusApiKey = data.helius_api_key ?? "";
      merged.birdeyeApiKey = data.birdeye_api_key ?? "";
      merged.xBearerToken = data.x_bearer_token ?? "";
      merged.geminiApiKey = data.gemini_api_key ?? "";
      merged.openaiApiKey = data.openai_api_key ?? "";
      merged.anthropicApiKey = data.anthropic_api_key ?? "";
      merged.groqApiKey = data.groq_api_key ?? "";
      merged.deepseekApiKey = data.deepseek_api_key ?? "";
      merged.telegramBotToken = data.telegram_bot_token ?? "";
      merged.telegramChatId = data.telegram_chat_id ?? "";
      merged.rpcUrl = data.rpc_url ?? "";
      merged.rpcUrlBackup = data.rpc_url_backup ?? "";
      merged.siteUrl = data.site_url ?? "";
      merged.smtpHost = data.smtp_host ?? "";
      if (data.smtp_port != null) {
        merged.smtpPort = Number(data.smtp_port);
        dbHasSmtpPort = true;
      }
      merged.smtpUser = data.smtp_user ?? "";
      merged.smtpPass = data.smtp_pass ?? "";
      merged.smtpFrom = data.smtp_from ?? "";
      merged.smtpFromName = data.smtp_from_name ?? "";
      if (data.smtp_secure != null) {
        merged.smtpSecure = Boolean(data.smtp_secure);
        dbHasSmtpSecure = true;
      }
      merged.maxBuySol = Number(data.max_buy_sol ?? DEFAULTS.maxBuySol);
      merged.dailySpendCapSol = Number(
        data.daily_spend_cap_sol ?? DEFAULTS.dailySpendCapSol,
      );
      merged.slippageBps = Number(data.slippage_bps ?? DEFAULTS.slippageBps);
      merged.minLiquidityUsd = Number(
        data.min_liquidity_usd ?? DEFAULTS.minLiquidityUsd,
      );
      merged.requireSafeScore = Number(
        data.require_safe_score ?? DEFAULTS.requireSafeScore,
      );
      merged.minSignalConfidence = Number(
        data.min_signal_confidence ?? DEFAULTS.minSignalConfidence,
      );
      merged.brandName = data.brand_name ?? "";
      merged.logoUrl = data.logo_url ?? "";
      merged.faviconUrl = data.favicon_url ?? "";
      merged.logoHeight = Number(data.logo_height ?? DEFAULTS.logoHeight);
      merged.showBrandName =
        data.show_brand_name == null ? true : Boolean(data.show_brand_name);
      merged.accentColor = data.accent_color ?? "";
      merged.adsEnabled = Boolean(data.ads_enabled);
      merged.tgBuyRoute = data.tg_buy_route || DEFAULTS.tgBuyRoute;
      merged.tgBuyRef = data.tg_buy_ref ?? "";
      merged.tgBuyTemplate = data.tg_buy_template ?? "";
      merged.boostsEnabled = Boolean(data.boosts_enabled);
      merged.boostWallet = data.boost_wallet ?? "";
      merged.boostTier1Sol = Number(data.boost_tier1_sol ?? DEFAULTS.boostTier1Sol);
      merged.boostTier1Hours = Number(data.boost_tier1_hours ?? DEFAULTS.boostTier1Hours);
      merged.boostTier2Sol = Number(data.boost_tier2_sol ?? DEFAULTS.boostTier2Sol);
      merged.boostTier2Hours = Number(data.boost_tier2_hours ?? DEFAULTS.boostTier2Hours);
      merged.boostTier3Sol = Number(data.boost_tier3_sol ?? DEFAULTS.boostTier3Sol);
      merged.boostTier3Hours = Number(data.boost_tier3_hours ?? DEFAULTS.boostTier3Hours);
    }
  }

  // Env fallbacks (only applied when the table left a value empty).
  if (!merged.heliusApiKey) merged.heliusApiKey = SERVER_ENV.heliusKeyEnv;
  if (!merged.birdeyeApiKey) merged.birdeyeApiKey = SERVER_ENV.birdeyeKeyEnv;
  if (!merged.xBearerToken) merged.xBearerToken = SERVER_ENV.xBearerEnv;
  if (!merged.geminiApiKey) merged.geminiApiKey = SERVER_ENV.geminiKeyEnv;
  if (!merged.openaiApiKey) merged.openaiApiKey = SERVER_ENV.openaiKeyEnv;
  if (!merged.anthropicApiKey)
    merged.anthropicApiKey = SERVER_ENV.anthropicKeyEnv;
  if (!merged.groqApiKey) merged.groqApiKey = SERVER_ENV.groqKeyEnv;
  if (!merged.deepseekApiKey)
    merged.deepseekApiKey = SERVER_ENV.deepseekKeyEnv;
  if (!merged.siteUrl) merged.siteUrl = SERVER_ENV.appUrl;
  if (!merged.telegramBotToken)
    merged.telegramBotToken = SERVER_ENV.telegramBotToken;
  if (!merged.telegramChatId)
    merged.telegramChatId = SERVER_ENV.telegramChatIdEnv;
  if (!merged.rpcUrl) merged.rpcUrl = SERVER_ENV.defaultRpcUrl;
  if (!merged.smtpHost) merged.smtpHost = SERVER_ENV.smtpHostEnv;
  if (!merged.smtpUser) merged.smtpUser = SERVER_ENV.smtpUserEnv;
  if (!merged.smtpPass) merged.smtpPass = SERVER_ENV.smtpPassEnv;
  if (!merged.smtpFrom) merged.smtpFrom = SERVER_ENV.smtpFromEnv;
  if (!dbHasSmtpPort && SERVER_ENV.smtpPortEnv)
    merged.smtpPort = Number(SERVER_ENV.smtpPortEnv) || merged.smtpPort;
  if (!dbHasSmtpSecure && SERVER_ENV.smtpSecureEnv)
    merged.smtpSecure = SERVER_ENV.smtpSecureEnv === "true";

  cache = { value: merged, expiry: Date.now() + TTL_MS };
  return merged;
}

export async function getRpcUrl(): Promise<string> {
  const cfg = await getAdminConfig();
  return cfg.rpcUrl || SERVER_ENV.defaultRpcUrl;
}

/**
 * Every RPC endpoint to try, in order, deduplicated.
 *
 * A Helius key is preferred over the free public endpoint because the public
 * one allows only a handful of requests per second per IP - on a serverless
 * host that IP is shared with every other tenant, which is exactly why holder
 * reads return "429 Too many requests for a specific RPC call".
 */
export async function getRpcUrls(): Promise<string[]> {
  const cfg = await getAdminConfig();
  const list: string[] = [];
  if (cfg.heliusApiKey) {
    list.push(
      "https://mainnet.helius-rpc.com/?api-key=" + cfg.heliusApiKey.trim(),
    );
  }
  if (cfg.rpcUrl) list.push(cfg.rpcUrl.trim());
  if (cfg.rpcUrlBackup) list.push(cfg.rpcUrlBackup.trim());
  list.push(SERVER_ENV.defaultRpcUrl);
  return Array.from(new Set(list.filter(Boolean)));
}

/**
 * The canonical public origin for links we put in Telegram messages and
 * emails. Admin config wins so that moving to a custom domain or cPanel is a
 * one-field change with no redeploy.
 */
export async function getSiteUrl(): Promise<string> {
  const cfg = await getAdminConfig();
  return (cfg.siteUrl || "").trim().replace(/\/+$/, "");
}

export interface BoostPackage {
  tier: 1 | 2 | 3;
  priceSol: number;
  hours: number;
}

/**
 * The boost packages currently on sale, cheapest first.
 *
 * A package priced at 0 (or with no duration) is treated as WITHDRAWN, not as
 * free. Clearing a price is the natural way an admin takes a tier off sale.
 */
export function boostPackages(cfg: AdminConfig): BoostPackage[] {
  const raw: BoostPackage[] = [
    { tier: 1, priceSol: Number(cfg.boostTier1Sol), hours: Number(cfg.boostTier1Hours) },
    { tier: 2, priceSol: Number(cfg.boostTier2Sol), hours: Number(cfg.boostTier2Hours) },
    { tier: 3, priceSol: Number(cfg.boostTier3Sol), hours: Number(cfg.boostTier3Hours) },
  ];
  return raw
    .filter((p) => Number.isFinite(p.priceSol) && Number.isFinite(p.hours))
    .filter((p) => p.priceSol > 0 && p.hours > 0)
    .sort((a, b) => a.priceSol - b.priceSol);
}

/** Boosts can only be sold with a payout wallet and something to sell. */
export function boostsReady(cfg: AdminConfig): boolean {
  return (
    Boolean(cfg.boostsEnabled) &&
    Boolean((cfg.boostWallet || "").trim()) &&
    boostPackages(cfg).length > 0
  );
}
