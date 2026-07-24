// Minimal signed-cookie session. Stores only the user id; the cookie is
// HMAC-signed with SESSION_SECRET so it cannot be forged.
import crypto from "crypto";
import { cookies } from "next/headers";
import { SERVER_ENV } from "../config";
import { getServiceClient } from "../supabase";
import type { Role, SessionUser } from "../types";

const COOKIE = "mr_session";

// Role hierarchy (feature #8). Higher number = more power.
export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  trader: 2,
  admin: 3,
  owner: 4,
};

function normalizeRole(role: string | null, isAdmin: boolean): Role {
  if (role === "owner" || role === "admin" || role === "trader" || role === "viewer") {
    return role;
  }
  return isAdmin ? "admin" : "viewer";
}

function sign(value: string): string {
  return crypto
    .createHmac("sha256", SERVER_ENV.sessionSecret)
    .update(value)
    .digest("hex");
}

export function setSession(userId: string): void {
  const payload = `${userId}.${sign(userId)}`;
  cookies().set(COOKIE, payload, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSession(): void {
  cookies().delete(COOKIE);
}

export function getSessionUserId(): string | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return null;
  const id = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  if (sign(id) !== sig) return null;
  return id;
}

/** Load the current user (with role) from the session cookie. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const id = getSessionUserId();
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
