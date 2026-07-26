// Withdrawal spending guards.
//
// A stolen session or a bug in the trade engine should not be able to empty a
// custodial wallet in one call. Every withdrawal passes three independent
// checks: a per-transfer ceiling, a rolling 24 hour total, and an optional
// destination allowlist. Limits are per user and stored on user_trade_settings.
import { getServiceClient } from "../supabase";

export type WithdrawLimits = {
  /** Largest single transfer, in SOL. */
  maxWithdrawSol: number;
  /** Total allowed across any rolling 24 hour window, in SOL. */
  dailyWithdrawCapSol: number;
  /** Require an emailed code bound to the exact amount and destination. */
  withdrawConfirmRequired: boolean;
  /** When non-empty, only these base58 addresses may receive funds. */
  withdrawAllowlist: string[];
};

/**
 * Deliberately conservative. A user who wants to move more can raise these in
 * wallet settings; the safe default protects accounts that never look.
 */
export const DEFAULT_LIMITS: WithdrawLimits = {
  maxWithdrawSol: 5,
  dailyWithdrawCapSol: 10,
  withdrawConfirmRequired: false,
  withdrawAllowlist: [],
};

function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : fallback;
}

function toAllowlist(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      return toAllowlist(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Reads a user's limits, falling back to DEFAULT_LIMITS. Never throws: if the
 * database is unreachable we return the strict defaults rather than opening up
 * the wallet, because failing closed is the safe direction here.
 */
export async function getWithdrawLimits(ownerId: string): Promise<WithdrawLimits> {
  const db = getServiceClient();
  if (!db) return DEFAULT_LIMITS;

  const { data } = await db
    .from("user_trade_settings")
    .select(
      "max_withdraw_sol, daily_withdraw_cap_sol, withdraw_confirm_required, withdraw_allowlist",
    )
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!data) return DEFAULT_LIMITS;

  return {
    maxWithdrawSol: toNumber(data.max_withdraw_sol, DEFAULT_LIMITS.maxWithdrawSol),
    dailyWithdrawCapSol: toNumber(
      data.daily_withdraw_cap_sol,
      DEFAULT_LIMITS.dailyWithdrawCapSol,
    ),
    withdrawConfirmRequired: data.withdraw_confirm_required === true,
    withdrawAllowlist: toAllowlist(data.withdraw_allowlist),
  };
}

/**
 * Sum of withdrawals in the last 24 hours. Failed attempts do not count against
 * the cap, since no funds actually left the wallet. Pending ones DO count, so a
 * burst of in-flight transfers cannot slip past the ceiling together.
 */
export async function withdrawnLast24h(ownerId: string): Promise<number> {
  const db = getServiceClient();
  if (!db) return 0;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from("wallet_transactions")
    .select("sol_amount, status")
    .eq("owner_id", ownerId)
    .eq("kind", "withdraw")
    .gte("created_at", since);

  if (!data) return 0;

  return data
    .filter((row) => row.status !== "failed")
    .reduce((sum, row) => sum + toNumber(row.sol_amount, 0), 0);
}

/**
 * Throws with a human-readable reason if this withdrawal is not permitted.
 * Returns the limits and the 24h total so the caller can decide whether an
 * emailed confirmation is also needed, without querying twice.
 */
export async function assertWithdrawAllowed(
  ownerId: string,
  to: string,
  amountSol: number,
): Promise<{ limits: WithdrawLimits; used24h: number }> {
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error("Enter a withdrawal amount greater than zero.");
  }

  const limits = await getWithdrawLimits(ownerId);

  if (limits.withdrawAllowlist.length > 0 && !limits.withdrawAllowlist.includes(to)) {
    throw new Error(
      "That destination is not on your withdrawal allowlist. Add it in wallet settings first.",
    );
  }

  if (amountSol > limits.maxWithdrawSol) {
    throw new Error(
      "That is above your per-transfer limit of " +
        limits.maxWithdrawSol +
        " SOL. Raise the limit in wallet settings or send a smaller amount.",
    );
  }

  const used24h = await withdrawnLast24h(ownerId);
  if (used24h + amountSol > limits.dailyWithdrawCapSol) {
    const left = Math.max(0, limits.dailyWithdrawCapSol - used24h);
    throw new Error(
      "That would exceed your 24 hour withdrawal cap of " +
        limits.dailyWithdrawCapSol +
        " SOL. You have " +
        left.toFixed(4) +
        " SOL left in this window.",
    );
  }

  return { limits, used24h };
}

/**
 * Persist withdrawal limits. Undefined fields are left untouched so a partial
 * form submit cannot silently reset a user's protections to defaults.
 */
export async function saveWithdrawLimits(
  ownerId: string,
  patch: {
    maxWithdrawSol?: number;
    dailyWithdrawCapSol?: number;
    withdrawConfirmRequired?: boolean;
    withdrawAllowlist?: string[];
  },
): Promise<WithdrawLimits> {
  const db = getServiceClient();
  if (!db) return DEFAULT_LIMITS;

  const row: Record<string, unknown> = {
    owner_id: ownerId,
    updated_at: new Date().toISOString(),
  };
  if (patch.maxWithdrawSol !== undefined) {
    row.max_withdraw_sol = patch.maxWithdrawSol;
  }
  if (patch.dailyWithdrawCapSol !== undefined) {
    row.daily_withdraw_cap_sol = patch.dailyWithdrawCapSol;
  }
  if (patch.withdrawConfirmRequired !== undefined) {
    row.withdraw_confirm_required = patch.withdrawConfirmRequired;
  }
  if (patch.withdrawAllowlist !== undefined) {
    row.withdraw_allowlist = patch.withdrawAllowlist;
  }

  // Only owner_id + updated_at present: nothing to change.
  if (Object.keys(row).length > 2) {
    const { error } = await db
      .from("user_trade_settings")
      .upsert(row, { onConflict: "owner_id" });
    if (error) throw new Error("Could not save limits: " + error.message);
  }

  return getWithdrawLimits(ownerId);
}
