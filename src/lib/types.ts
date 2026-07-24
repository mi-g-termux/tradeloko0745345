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
  suggestedEntry: string | null;
  invalidation: string | null;
  rationale: string[];
  indicators: Indicators;
  patterns: ChartPattern[];
  safetyScore: number | null;
  ai: AiVerdict | null;
  aiEnabled: boolean;
  social: SocialStats | null;
  updatedAt: string;
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

export interface PortfolioResult {
  wallet: string;
  solBalance: number;
  holdings: PortfolioHolding[];
  totalValueUsd: number;
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
