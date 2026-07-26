// Email sign-in codes — lets an admin sign in from ANY device without the
// wallet that originally created the account.
//
// WHY A CODE AND NOT A MAGIC LINK
// -------------------------------
// Click-to-login links get followed by mail scanners, link previewers and
// corporate proxies, which would silently consume (or worse, trigger) the login.
// A 6-digit code typed by a human avoids that entire class of problem.
//
// SECURITY MODEL
// --------------
// - The plaintext code is never stored, only a SHA-256 hash.
// - Codes expire after 10 minutes and are single-use.
// - Max 5 wrong guesses per code, then it is dead (10^6 space, so brute force
//   is not feasible within the window).
// - Only accounts that ALREADY exist and already hold admin/owner may use this.
//   It cannot create accounts and cannot escalate a viewer, so it is not a way
//   in for a stranger who guesses your email.
// - Requests always return the same response whether or not the email matches,
//   so this endpoint cannot be used to discover who the admins are.
import crypto from "crypto";
import { getServiceClient } from "../supabase";
import { publicBaseUrl, appBaseUrl } from "../config";
import { sendEmail } from "../notify/email";
import { loginCodeEmail } from "../notify/emailTemplates";
import { ROLE_RANK } from "./session";
import type { Role } from "../types";

export const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Do not send more than this many codes to one address per hour. */
const MAX_CODES_PER_HOUR = 5;

function hash(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Cryptographically random 6-digit code (no Math.random). */
function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export type RequestOutcome =
  | { ok: true; sent: boolean; note?: string }
  | { ok: false; error: string; status: number };

/**
 * Issue a sign-in code for an admin email address.
 *
 * Returns `sent: false` (still ok: true) when the address does not belong to an
 * eligible admin — the caller must show an identical message either way.
 */
export async function requestLoginCode(
  rawEmail: string,
  requestedIp?: string,
): Promise<RequestOutcome> {
  const email = rawEmail.trim().toLowerCase();
  if (!isEmail(email)) {
    return { ok: false, error: "Enter a valid email address.", status: 400 };
  }

  const db = getServiceClient();
  if (!db) return { ok: false, error: "No database", status: 500 };

  // Throttle per address regardless of whether it exists, so this cannot be
  // used as a mail bomb either.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recent } = await db
    .from("email_login_codes")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", hourAgo);
  if ((recent ?? 0) >= MAX_CODES_PER_HOUR) {
    return {
      ok: false,
      error: "Too many codes requested. Wait an hour and try again.",
      status: 429,
    };
  }

  const { data: user } = await db
    .from("app_users")
    .select("id, email, role, is_admin")
    .ilike("email", email)
    .maybeSingle();

  const role = (user?.role ?? "viewer") as Role;
  const eligible =
    Boolean(user) &&
    (ROLE_RANK[role] >= ROLE_RANK.admin || Boolean(user?.is_admin));

  // Unknown address, or a non-admin: do nothing, but report success so the
  // response cannot be used to enumerate admin emails.
  if (!user || !eligible) {
    console.warn("[email-login] ignored code request for non-admin:", email);
    return { ok: true, sent: false };
  }

  const code = generateCode();
  const expiresAt = new Date(
    Date.now() + CODE_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  const { error: insertError } = await db.from("email_login_codes").insert({
    email,
    code_hash: hash(code),
    user_id: user.id,
    expires_at: expiresAt,
    requested_ip: requestedIp ?? null,
  });
  if (insertError) {
    return { ok: false, error: insertError.message, status: 500 };
  }

  // force: true — a login code is account access, not a marketing notification,
  // so it must not be suppressed by the global email-notifications toggle.
  const built = loginCodeEmail({
    code,
    appUrl: publicBaseUrl() || appBaseUrl(),
    minutes: CODE_TTL_MINUTES,
  });
  const res = await sendEmail(email, built, "login_code", {
    ownerId: user.id,
    force: true,
  });

  if (!res.ok) {
    // Surface SMTP problems: silently "succeeding" here would strand the admin
    // waiting for an email that is never coming.
    return {
      ok: false,
      error:
        "Could not send the code: " +
        (res.error ?? "unknown SMTP error") +
        ". Check Admin → Email (SMTP) settings, or use another sign-in method.",
      status: 502,
    };
  }

  return { ok: true, sent: true };
}

export type VerifyOutcome =
  | { ok: true; userId: string }
  | { ok: false; error: string; status: number };

/** Validate a submitted code and return the user id to open a session for. */
export async function verifyLoginCode(
  rawEmail: string,
  rawCode: string,
): Promise<VerifyOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.replace(/\D/g, "");
  if (!isEmail(email) || code.length !== 6) {
    return { ok: false, error: "Enter the 6-digit code from your email.", status: 400 };
  }

  const db = getServiceClient();
  if (!db) return { ok: false, error: "No database", status: 500 };

  const { data: row } = await db
    .from("email_login_codes")
    .select("id, code_hash, user_id, expires_at, used, attempts")
    .eq("email", email)
    .eq("used", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return {
      ok: false,
      error: "No active code for that address. Request a new one.",
      status: 400,
    };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "That code has expired. Request a new one.", status: 400 };
  }
  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
    return {
      ok: false,
      error: "Too many incorrect attempts. Request a new code.",
      status: 429,
    };
  }

  const provided = Buffer.from(hash(code), "hex");
  const expected = Buffer.from(row.code_hash, "hex");
  const match =
    provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected);

  if (!match) {
    await db
      .from("email_login_codes")
      .update({ attempts: (row.attempts ?? 0) + 1 })
      .eq("id", row.id);
    return { ok: false, error: "Incorrect code.", status: 403 };
  }

  // Burn the code before opening the session so it can never be replayed.
  await db.from("email_login_codes").update({ used: true }).eq("id", row.id);

  if (!row.user_id) {
    return { ok: false, error: "That code is no longer valid.", status: 400 };
  }

  await db
    .from("app_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", row.user_id);

  return { ok: true, userId: row.user_id };
}
