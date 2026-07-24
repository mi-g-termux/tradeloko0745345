// User upsert helpers for the two login methods (wallet + Telegram).
import { getServiceClient } from "../supabase";
import { SERVER_ENV } from "../config";

/**
 * ADMIN BOOTSTRAP RULE
 * --------------------
 * The FIRST person to sign in (by any method) becomes the permanent "owner".
 * Once an owner or admin exists, every later sign-up is a plain "viewer".
 * => The admin NEVER changes when other people register later, from any device.
 *
 * Optional: set BOOTSTRAP_ADMIN_WALLET to pin ownership to one specific wallet
 * regardless of sign-up order (useful if you want a guaranteed admin).
 */
async function noPrivilegedUserExists(
  db: NonNullable<ReturnType<typeof getServiceClient>>,
): Promise<boolean> {
  const { count } = await db
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .in("role", ["owner", "admin"]);
  return (count ?? 0) === 0;
}

/** Find-or-create a user by wallet address. Bootstraps the first owner. */
export async function upsertWalletUser(
  walletAddress: string,
): Promise<string | null> {
  const db = getServiceClient();
  if (!db) return null;

  const { data: existing } = await db
    .from("app_users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  if (existing) {
    await db
      .from("app_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing.id;
  }

  const isBootstrapAdmin =
    Boolean(SERVER_ENV.bootstrapAdminWallet) &&
    SERVER_ENV.bootstrapAdminWallet === walletAddress;
  const makeOwner = isBootstrapAdmin || (await noPrivilegedUserExists(db));

  const { data: created } = await db
    .from("app_users")
    .insert({
      wallet_address: walletAddress,
      is_admin: makeOwner,
      role: makeOwner ? "owner" : "viewer",
      last_login_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  return created?.id ?? null;
}

/** Find-or-create a user by Telegram id. Also bootstraps the first owner. */
export async function upsertTelegramUser(
  telegramId: string,
  username?: string,
  displayName?: string,
): Promise<string | null> {
  const db = getServiceClient();
  if (!db) return null;

  const { data: existing } = await db
    .from("app_users")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (existing) {
    await db
      .from("app_users")
      .update({
        telegram_username: username ?? null,
        display_name: displayName ?? null,
        last_login_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const makeOwner = await noPrivilegedUserExists(db);

  const { data: created } = await db
    .from("app_users")
    .insert({
      telegram_id: telegramId,
      telegram_username: username ?? null,
      display_name: displayName ?? null,
      is_admin: makeOwner,
      role: makeOwner ? "owner" : "viewer",
      last_login_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  return created?.id ?? null;
}
