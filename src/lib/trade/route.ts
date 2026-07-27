// Ownership-aware trade router.
//
// WHY THIS EXISTS
// Automated trades come from two very different places:
//
//   1. A USER's own automation (a limit/TP/SL order they created, or a
//      copy-trade rule on a wallet they track). The row carries their
//      owner_id. This must spend THEIR custodial wallet, respect THEIR caps,
//      and deliver the tokens to THEM.
//
//   2. Admin/site-level automation with no owner_id. Only this may use the
//      server hot wallet (AUTO_BUY_SIGNER_KEY).
//
// Previously both paths called executeServerBuy(), which always signs with the
// server key and only used ownerId for bookkeeping. That meant a user's limit
// order spent the ADMIN's SOL, delivered the tokens to the ADMIN's wallet, and
// then emailed the user that "their" buy had executed. It also let every user
// share one global daily spend cap of the admin's money.
//
// Everything below routes on `ownerId` so the payer, the receiver, and the
// person credited are always the same account.
import { getServiceClient } from "../supabase";
import { getAdminConfig } from "../adminConfig";
import { analyzeSafety } from "../data/safety";
import { buyWithUserWallet, sellAllWithUserWallet } from "./custodialTrade";
import { executeServerBuy, executeServerSellAll } from "./execute";

export interface RoutedResult {
  ok: boolean;
  signature?: string;
  error?: string;
  safetyScore?: number | null;
  proceedsSol?: number;
  /** Which wallet actually paid. Useful for logs and cron summaries. */
  payer?: "user" | "server";
}

export interface RoutedBuyRequest {
  tokenAddress: string;
  amountSol: number;
  source: string;
  sourceRef?: string;
  ownerId?: string | null;
  reason?: string | null;
}

interface UserCaps {
  maxBuySol: number;
  dailyCapSol: number;
}

// Mirrors the defaults in user_trade_settings so a user who never opened the
// settings screen still gets conservative limits rather than none.
const FALLBACK_CAPS: UserCaps = { maxBuySol: 0.1, dailyCapSol: 1 };

async function userCaps(db: any, ownerId: string): Promise<UserCaps> {
  const { data } = await db
    .from("user_trade_settings")
    .select("max_buy_sol, daily_cap_sol")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!data) return FALLBACK_CAPS;
  return {
    maxBuySol: Number(data.max_buy_sol ?? FALLBACK_CAPS.maxBuySol),
    dailyCapSol: Number(data.daily_cap_sol ?? FALLBACK_CAPS.dailyCapSol),
  };
}

/** SOL this specific user has spent on buys in the last 24h. */
async function userSpentLast24h(db: any, ownerId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await db
    .from("wallet_transactions")
    .select("sol_amount")
    .eq("owner_id", ownerId)
    .eq("kind", "buy")
    .gte("created_at", since);
  return (data ?? []).reduce(
    (s: number, r: any) => s + Number(r.sol_amount ?? 0),
    0,
  );
}

/**
 * BUY on behalf of whoever owns the automation.
 *
 * - ownerId present -> the user's custodial wallet, under the user's own caps.
 * - ownerId null    -> the server signer wallet, under the admin's caps.
 */
export async function routedBuy(req: RoutedBuyRequest): Promise<RoutedResult> {
  const ownerId = req.ownerId ?? null;

  // No owner: genuine site-level automation. Unchanged behaviour.
  if (!ownerId) {
    const res = await executeServerBuy({
      tokenAddress: req.tokenAddress,
      amountSol: req.amountSol,
      source: req.source,
      sourceRef: req.sourceRef,
      ownerId: null,
      reason: req.reason ?? null,
    });
    return { ...res, payer: "server" };
  }

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Database not configured.", payer: "user" };

  const cfg = await getAdminConfig();

  // The admin safety gate still applies to automated user buys. A user cannot
  // use automation to buy something the site considers unsafe.
  const safety = await analyzeSafety(req.tokenAddress).catch(() => null);
  const safetyScore = safety?.score ?? null;
  if (safetyScore == null || safetyScore < cfg.requireSafeScore) {
    return {
      ok: false,
      safetyScore,
      payer: "user",
      error:
        "Safety " +
        String(safetyScore ?? "n/a") +
        " below required " +
        String(cfg.requireSafeScore) +
        ".",
    };
  }

  // The user's own caps, not the shared admin budget.
  const caps = await userCaps(db, ownerId);
  let amount = Number(req.amountSol);
  if (!amount || amount <= 0) {
    return { ok: false, error: "Invalid amount.", payer: "user" };
  }
  if (amount > caps.maxBuySol) amount = caps.maxBuySol;

  const spent = await userSpentLast24h(db, ownerId);
  const remaining = caps.dailyCapSol - spent;
  if (remaining <= 0) {
    return {
      ok: false,
      payer: "user",
      error:
        "Your daily cap of " + String(caps.dailyCapSol) + " SOL is used up.",
    };
  }
  if (amount > remaining) amount = remaining;

  const res = await buyWithUserWallet(ownerId, req.tokenAddress, amount);
  return {
    ok: res.ok,
    signature: res.signature,
    error: res.error,
    safetyScore,
    payer: "user",
  };
}

/**
 * SELL the whole position for whoever owns the automation.
 *
 * Deliberately NO safety gate and NO spend caps here: this is the exit path.
 * A stop-loss must always be allowed to fire, and a token turning unsafe is a
 * reason to sell faster, never a reason to trap the user in the position.
 */
export async function routedSellAll(
  tokenAddress: string,
  opts: { ownerId?: string | null; reason?: string | null; symbol?: string | null },
): Promise<RoutedResult> {
  const ownerId = opts.ownerId ?? null;

  if (!ownerId) {
    const res = await executeServerSellAll(tokenAddress, {
      ownerId: null,
      reason: opts.reason ?? null,
      symbol: opts.symbol ?? null,
    });
    return { ...res, payer: "server" };
  }

  const res = await sellAllWithUserWallet(ownerId, tokenAddress);
  return {
    ok: res.ok,
    signature: res.signature,
    error: res.error,
    proceedsSol: res.proceedsSol,
    payer: "user",
  };
}
