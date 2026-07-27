// Shared domain types.

export interface TokenSummary {
  address: string;
  name: string;
  symbol: string;
  priceUsd: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  volume24h: number | null;
  txns24hBuys: number | null;
  txns24hSells: number | null;
  pairCreatedAt: number | null;
  ageHours: number | null;
  dexId: string | null;
  pairAddress: string | null;
  url: string | null;
  imageUrl: string | null;
  // ── Multi-timeframe market data (DexScreener-style columns). Optional so
  // every existing TokenSummary producer keeps compiling; the scanner UI
  // renders "—" when a window is unavailable. ──
  priceChange5m?: number | null;
  priceChange6h?: number | null;
  volume5m?: number | null;
  volume1h?: number | null;
  volume6h?: number | null;
  txns5m?: number | null;
  txns1h?: number | null;
  txns6h?: number | null;
  txns24h?: number | null;
  buys5m?: number | null;
  sells5m?: number | null;
  /** Distinct-ish trader count proxy for 24h (buys + sells makers). */
  traders24h?: number | null;
  /** DexScreener paid-boost amount, when the pair is boosted. */
  boosts?: number | null;
  quoteSymbol?: string | null;
  /** True when the pair was pinned by an admin (rides top of the scanner). */
  pinned?: boolean;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;
}

/** How much real evidence a signal was actually built from. */
export type QualityLevel = "high" | "medium" | "low" | "none";

export interface SignalQuality {
  /** Number of OHLCV candles the indicators were computed from. */
  candles: number;
  /** Candle timeframe actually used (adaptive to token age). */
  timeframe: string;
  level: QualityLevel;
  /** Human-readable reasons the quality is degraded. */
  notes: string[];
}

export interface SafetyFactor {
  key: string;
  label: string;
  ok: boolean;
  weight: number;
  detail: string;
}

export interface SafetyReport {
  address: string;
  score: number; // 0-100, higher = safer
  verdict: "danger" | "caution" | "ok";
  factors: SafetyFactor[];
  notes: string[];
  updatedAt: string;
}

export interface WalletActivity {
  wallet: string;
  label?: string;
  action: "buy" | "sell" | "unknown";
  tokenAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  marketCap?: number | null;
  priceUsd?: number | null;
  amountSol?: number;
  signature: string;
  timestamp: number;
}

// viewer < trader < admin < owner
export type Role = "viewer" | "trader" | "admin" | "owner";

export interface SessionUser {
  id: string;
  walletAddress: string | null;
  telegramUsername: string | null;
  displayName: string | null;
  isAdmin: boolean;
  role: Role;
}

// ── Analysis (ported from the Quotex project, rebuilt for memecoins) ──

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  atr14: number | null;
  support: number | null;
  resistance: number | null;
  trend: "up" | "down" | "sideways";
  /** How many candles fed the calculation (0 = no real chart data). */
  candleCount?: number;
  /** ATR as a share of price — memecoin volatility context. */
  atrPct?: number | null;
}

export type PatternDirection = "bullish" | "bearish" | "neutral";

export interface ChartPattern {
  name: string;
  direction: PatternDirection;
  confidence: number; // 0-1
  detail: string;
}

export interface AiVerdict {
  lean: PatternDirection;
  confidence: number; // 0-100
  reasoning: string;
  entryZone: string | null;
  invalidation: string | null;
  targets: string[];
  model: string;
}

export interface SocialStats {
  available: boolean;
  needsKey: boolean;
  mentionCount: number;
  sentiment: number; // -1 (bearish) .. 1 (bullish)
  topTweets: { text: string; likes: number; url: string }[];
}

export interface TradeSignal {
  address: string;
  symbol: string;
  direction: PatternDirection;
  confidence: number; // 0-100
  score: number; // -100..100 composite
  priceUsd: number | null; // price at signal time (for outcome tracking)
  marketCap: number | null; // market cap at signal time
  suggestedEntry: string | null;
  invalidation: string | null;
  targets: string[]; // suggested take-profit levels
  stopLoss: string | null; // suggested stop / risk level
  rationale: string[];
  indicators: Indicators;
  patterns: ChartPattern[];
  safetyScore: number | null;
  ai: AiVerdict | null;
  aiEnabled: boolean;
  social: SocialStats | null;
  updatedAt: string;
  /** Evidence/data-quality report. Low quality => confidence is capped. */
  quality?: SignalQuality;
  /** Timeframe-labelled contributions that produced the score (for the UI). */
  factors?: Array<{ label: string; points: number; detail: string }>;
  /**
   * Full price-action read behind the call: market structure, the 24h session
   * scan, key levels, liquidity pools and candlestick formations.
   */
  analysis?: {
    /** Plain-English market structure summary. */
    structure: string;
    /** Liquidity-based institutional setups (Quasimodo, SR flip, stop hunt). */
    institutional: Array<{
      name: string;
      side: "bullish" | "bearish";
      level: number | null;
      invalidation: number | null;
      detail: string;
    }>;
    /** The swing sequence, e.g. "HH → HL → HH". */
    sequence: string;
    superTrend: string | null;
    fib: string | null;
    session: {
      hoursCovered: number;
      complete: boolean;
      bars: number;
      high: number;
      low: number;
      vwap: number;
      /** 0 = at the 24h low, 1 = at the 24h high. */
      rangePosition: number;
      /** Second-half volume / first-half volume. */
      volumeTrend: number;
      /** Volume imbalance, -1 (all selling) .. 1 (all buying). */
      pressure: number;
      changePct: number;
    } | null;
    levels: Array<{
      price: number;
      kind: "support" | "resistance";
      touches: number;
      distancePct: number;
    }>;
    liquidity: Array<{ price: number; side: "buy-side" | "sell-side" }>;
    candlesticks: Array<{
      name: string;
      direction: PatternDirection;
      barsAgo: number;
      detail: string;
    }>;
  };
}

// ── Branding (admin-managed logo / favicon / theme) ──

export interface Branding {
  appName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  logoHeight: number;
  showAppNameBesideLogo: boolean;
  accentColor: string | null;
}

// ── Ad placements ──

export type AdSlotId =
  | "top_banner"
  | "scanner_inline"
  | "sidebar"
  | "token_page"
  | "footer";

export interface AdCreative {
  id: string;
  slot: AdSlotId;
  title: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  html: string | null;
  enabled: boolean;
  weight: number;
  impressions: number;
  clicks: number;
  createdAt?: string;
}

// ── Automation / cron health ──

export interface CronRunInfo {
  job: string;
  lastRunAt: string | null;
  lastStatus: "ok" | "skipped" | "error" | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastResult: unknown;
  runs24h: number;
  errors24h: number;
  /** Expected cadence in minutes (what the cron-job.org entry should use). */
  expectedEveryMinutes: number;
  /** True when the last run is older than ~2.5x the expected cadence. */
  overdue: boolean;
}

// ── New feature types ──

/** A freshly-launched token (launch feed). */
export interface LaunchToken {
  address: string;
  symbol: string;
  name: string;
  ageMinutes: number | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
  isPumpFun: boolean;
  safetyScore: number | null;
  url: string | null;
}

/** A wallet holding for the portfolio / PnL page. */
export interface PortfolioHolding {
  tokenAddress: string;
  symbol: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  costSol: number | null;   // known cost basis from buy_orders, if any
}

/**
 * Trading summary for a wallet, computed from this app's own records.
 *
 * Only meaningful for the signed-in user's own wallet: it is derived from
 * buy_orders and wallet_transactions, which exist only for activity that passed
 * through this app. Viewing a stranger's address returns null rather than
 * inventing numbers that cannot be known from the chain alone.
 */
export interface PortfolioStats {
  investedSol: number;
  soldSol: number;
  realisedPnlSol: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  /** 0-100, or null when nothing has been closed yet. */
  winRate: number | null;
  /** Mean holding time in hours across closed positions, or null. */
  avgHoldHours: number | null;
  lastTradedAt: string | null;
  depositedSol: number;
  withdrawnSol: number;
}

export interface PortfolioResult {
  wallet: string;
  solBalance: number;
  holdings: PortfolioHolding[];
  totalValueUsd: number;
  stats: PortfolioStats | null;
}

/** One capability shown on the welcome / features screen. */
export interface FeatureInfo {
  key: string;
  label: string;
  description: string;
  href: string;
  status: "live" | "needs_key" | "off";
  note?: string;
}

// ── Email notifications & price-condition alerts ──

/** Per-user notification preferences (stored on app_users). */
export interface NotificationPrefs {
  email: string | null;
  notifyEmailEnabled: boolean;
  notifyOnBuy: boolean;
  notifyOnSell: boolean;
}

export type TradeAction = "buy" | "sell";

/** A single trade event that can be emailed to a user. */
export interface TradeEvent {
  ownerId: string | null;
  action: TradeAction;
  symbol: string;
  tokenAddress: string;
  amountSol: number;        // SOL spent (buy) or received (sell)
  priceUsd: number | null;
  source: string;           // manual | auto | copy | keeper
  signature?: string | null;
  // Sell-only profit/loss (in SOL) vs known cost basis.
  pnlSol?: number | null;
  pnlPct?: number | null;
  reason?: string | null;   // e.g. take-profit, stop-loss, copy of <wallet>
}

export type AlertDirection = "up" | "down";

/** A user-defined price-condition alert. */
export interface PriceAlert {
  id: string;
  tokenAddress: string;
  symbol: string | null;
  direction: AlertDirection;
  pct: number;              // percent move from baseline (2x => 100)
  label: string | null;
  baselinePrice: number | null;
  enabled: boolean;
  repeat: boolean;
  lastPrice: number | null;
  triggeredAt: string | null;
  createdAt: string;
}
