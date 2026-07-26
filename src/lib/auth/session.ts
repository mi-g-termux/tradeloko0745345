// Server-side sessions.
//
// WHAT CHANGED AND WHY
// This used to be a stateless signed cookie: `<userId>.<hmac>`. It could not be
// revoked. A stolen cookie stayed valid for its full 7 days even after the
// account was demoted or the theft was noticed, and there was no way to "sign
// out other devices". Rotating SESSION_SECRET was the only remedy, and that
// logged out every user at once.
//
// Now the cookie holds an opaque 256-bit random token and only its SHA-256 hash
// is stored in `user_sessions`, so a database leak cannot be replayed as a
// login. Every request checks the row exists, is not revoked, and has not
// expired - which is what makes instant revocation possible.
//
// UPGRADE NOTE: old stateless cookies are rejected, so everyone signs in once
// more after deploying. That is the safe direction to fail.
import crypto from "crypto";
import { cookies } from "next/headers";
import { getServiceClient } from "../supabase";
import type { Role, SessionUser } from "../types";

const COOKIE = "mr_session";
const SESSION_DAYS = 7;
/** Refresh last_seen_at at most this often, to avoid a write per request. */
const TOUCH_AFTER_MS = 10 * 60 * 1000;

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  trader: 2,
  admin: 3,
  owner: 4,
};

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

function normalizeRole(role: string | null, isAdmin: boolean): Role {
  if (role === "owner" || role === "admin" || role === "trader" || role === "viewer") {
    return role;
  }
  return isAdmin ? "admin" : "viewer";
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readCookie(): string | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  // Legacy stateless cookies contained a "." separator. Reject them.
  if (raw.includes(".")) return null;
  if (!/^[0-9a-f]{64}$/.test(raw)) return null;
  return raw;
}

/** Create a session row and set the cookie. */
export async function setSession(
  userId: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  const db = getServiceClient();
  if (!db) throw new Error("Database not configured; cannot start a session.");

  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await db.from("user_sessions").insert({
    user_id: userId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
    user_agent: meta?.userAgent ?? null,
    ip: meta?.ip ?? null,
  });
  if (error) throw new Error("Could not start session: " + error.message);

  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Revoke the current session server-side and drop the cookie. */
export async function clearSession(): Promise<void> {
  const token = readCookie();
  cookies().delete(COOKIE);
  if (!token) return;
  const db = getServiceClient();
  if (!db) return;
  await db
    .from("user_sessions")
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token));
}

/** Resolve the cookie to a user id, enforcing revocation and expiry. */
export async function getSessionUserId(): Promise<string | null> {
  const token = readCookie();
  if (!token) return null;
  const db = getServiceClient();
  if (!db) return null;

  const { data } = await db
    .from("user_sessions")
    .select("id, user_id, revoked, expires_at, last_seen_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!data || data.revoked) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  const last = data.last_seen_at ? new Date(data.last_seen_at).getTime() : 0;
  if (Date.now() - last > TOUCH_AFTER_MS) {
    await db
      .from("user_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", data.id);
  }

  return data.user_id as string;
}

/** Load the current user (with role) from the session cookie. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const id = await getSessionUserId();
  if (!id) return null;
  const db = getServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("app_users")
    .select("id, wallet_address, telegram_username, display_name, is_admin, role")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const role = normalizeRole(data.role, Boolean(data.is_admin));
  return {
    id: data.id,
    walletAddress: data.wallet_address,
    telegramUsername: data.telegram_username,
    displayName: data.display_name,
    isAdmin: role === "admin" || role === "owner" || Boolean(data.is_admin),
    role,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in required");
  return user;
}

/** Require at least the given role. owner >= admin >= trader >= viewer. */
export async function requireRole(min: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (ROLE_RANK[user.role] < ROLE_RANK[min]) {
    throw new Error(`Requires ${min} role or higher`);
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user || !user.isAdmin) {
    throw new Error("Admin access required");
  }
  return user;
}

// ---- Session management (used by /api/auth/sessions) ----

export async function listSessions(userId: string): Promise<SessionInfo[]> {
  const db = getServiceClient();
  if (!db) return [];
  const token = readCookie();
  const currentHash = token ? hashToken(token) : null;
  const { data } = await db
    .from("user_sessions")
    .select("id, token_hash, created_at, last_seen_at, user_agent, ip")
    .eq("user_id", userId)
    .eq("revoked", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    lastSeenAt: (r.last_seen_at as string) ?? null,
    userAgent: (r.user_agent as string) ?? null,
    ip: (r.ip as string) ?? null,
    current: currentHash != null && r.token_hash === currentHash,
  }));
}

/** Revoke one session by id (ownership enforced by the user_id filter). */
export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  await db
    .from("user_sessions")
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", sessionId);
}

/** Revoke every session for a user. exceptCurrent keeps the caller signed in. */
export async function revokeAllSessions(
  userId: string,
  exceptCurrent = false,
): Promise<number> {
  const db = getServiceClient();
  if (!db) return 0;
  const token = exceptCurrent ? readCookie() : null;
  let q = db
    .from("user_sessions")
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("revoked", false);
  if (token) q = q.neq("token_hash", hashToken(token));
  const { data } = await q.select("id");
  return (data ?? []).length;
}
