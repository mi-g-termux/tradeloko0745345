
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
