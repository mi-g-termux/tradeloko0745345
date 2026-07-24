// Reads the single-row admin_config, merging in env fallbacks.
// Secrets returned here must stay server-side.
import { getServiceClient } from "./supabase";
import { SERVER_ENV } from "./config";

export interface AdminConfig {
  autoBuyEnabled: boolean;
  whaleTrackingEnabled: boolean;
  whaleWallets: string;
  xFeedEnabled: boolean;
  aiEnabled: boolean;
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
  telegramBotToken: string;
  telegramChatId: string;
  rpcUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  smtpSecure: boolean;
  maxBuySol: number;
  dailySpendCapSol: number;
  slippageBps: number;
  minLiquidityUsd: number;
  requireSafeScore: number;
  minSignalConfidence: number;
}

const DEFAULTS: AdminConfig = {
  autoBuyEnabled: false,
  whaleTrackingEnabled: false,
  whaleWallets: "",
  xFeedEnabled: false,
  aiEnabled: false,
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
  telegramBotToken: "",
  telegramChatId: "",
  rpcUrl: "",
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  smtpSecure: false,
  maxBuySol: 0.1,
  dailySpendCapSol: 1.0,
  slippageBps: 100,
  minLiquidityUsd: 5000,
  requireSafeScore: 60,
  minSignalConfidence: 55,
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
      merged.xFeedEnabled = Boolean(data.x_feed_enabled);
      merged.aiEnabled = Boolean(data.ai_enabled);
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
      merged.telegramBotToken = data.telegram_bot_token ?? "";
      merged.telegramChatId = data.telegram_chat_id ?? "";
      merged.rpcUrl = data.rpc_url ?? "";
      merged.smtpHost = data.smtp_host ?? "";
      if (data.smtp_port != null) {
        merged.smtpPort = Number(data.smtp_port);
        dbHasSmtpPort = true;
      }
      merged.smtpUser = data.smtp_user ?? "";
      merged.smtpPass = data.smtp_pass ?? "";
      merged.smtpFrom = data.smtp_from ?? "";
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
    }
  }

  // Env fallbacks (only applied when the table left a value empty).
  if (!merged.heliusApiKey) merged.heliusApiKey = SERVER_ENV.heliusKeyEnv;
  if (!merged.birdeyeApiKey) merged.birdeyeApiKey = SERVER_ENV.birdeyeKeyEnv;
  if (!merged.xBearerToken) merged.xBearerToken = SERVER_ENV.xBearerEnv;
  if (!merged.geminiApiKey) merged.geminiApiKey = SERVER_ENV.geminiKeyEnv;
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
