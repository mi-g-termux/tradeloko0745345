// Two-step confirmation for custodial withdrawals.
//
// A session cookie alone should not be enough to move funds off the platform.
// When a user enables `withdraw_confirm_required`, every withdrawal needs a
// fresh code delivered to their registered email, so an attacker needs the
// mailbox as well as the browser session.
//
// The code is bound to the exact destination and amount requested: an approval
// for "0.1 SOL to address A" cannot be replayed as "50 SOL to address B".
import crypto from "crypto";
import { getServiceClient } from "../supabase";
import { sendEmail } from "../notify/email";
import type { BuiltEmail } from "../notify/emailTemplates";

const CODE_TTL_MINUTES = 10;
const MAX_PENDING_PER_HOUR = 6;

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function generateCode(): string {
  // randomInt is uniform and unpredictable; Math.random is not acceptable here.
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

/** Bind a code to its destination and amount so approvals cannot be reused. */
function intentKey(toAddress: string, amountSol: number): string {
  return toAddress + "|" + amountSol.toFixed(9);
}

function confirmEmail(opts: {
  code: string;
  toAddress: string;
  amountSol: number;
  minutes: number;
}): BuiltEmail {
  const short = opts.toAddress.slice(0, 6) + "..." + opts.toAddress.slice(-6);
  const subject = "Confirm withdrawal of " + opts.amountSol + " SOL";
  const text = [
    "Confirmation code: " + opts.code,
    "",
    "Amount: " + opts.amountSol + " SOL",
    "Destination: " + opts.toAddress,
    "This code expires in " + opts.minutes + " minutes.",
    "",
    "If you did not request this withdrawal, do not enter the code. " +
      "Sign out all devices from your account page.",
  ].join("\n");
  const html = [
    '<div style="font-family:system-ui,sans-serif;background:#0a0c10;color:#e2e8f0;padding:24px">',
    '<h2 style="margin:0 0 12px">Confirm your withdrawal</h2>',
    '<p style="margin:0 0 16px;color:#7c88a1">Amount <strong style="color:#e2e8f0">' +
      opts.amountSol +
      " SOL</strong> to <code>" +
      short +
      "</code></p>",
    '<div style="font-size:30px;letter-spacing:6px;font-weight:700;color:#6366f1;margin:16px 0">' +
      opts.code +
      "</div>",
    '<p style="margin:0 0 16px;color:#7c88a1">Expires in ' +
      opts.minutes +
      " minutes.</p>",
    '<p style="margin:0;color:#ef4444">Did not request this? Do not enter the code, and sign out all devices immediately.</p>',
    "</div>",
  ].join("");
  return { subject, html, text };
}

export interface ConfirmRequestOutcome {
  ok: boolean;
  sent: boolean;
  error?: string;
  expiresInMinutes: number;
}

/** Create a pending confirmation and email the code to the account owner. */
export async function requestWithdrawConfirmation(
  ownerId: string,
  toAddress: string,
  amountSol: number,
): Promise<ConfirmRequestOutcome> {
  const db = getServiceClient();
  if (!db) {
    return {
      ok: false,
      sent: false,
      error: "Database not configured.",
      expiresInMinutes: CODE_TTL_MINUTES,
    };
  }

  const { data: user } = await db
    .from("app_users")
    .select("email")
    .eq("id", ownerId)
    .maybeSingle();
  const email = (user?.email as string) || "";
  if (!email) {
    return {
      ok: false,
      sent: false,
      error:
        "No email is saved on your account, so a withdrawal code cannot be sent. " +
        "Add an email in Account & alerts, or turn off withdrawal confirmation.",
      expiresInMinutes: CODE_TTL_MINUTES,
    };
  }

  // Throttle: stops an attacker spamming the owner's inbox into fatigue.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("withdraw_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= MAX_PENDING_PER_HOUR) {
    return {
      ok: false,
      sent: false,
      error: "Too many withdrawal confirmations requested. Wait an hour.",
      expiresInMinutes: CODE_TTL_MINUTES,
    };
  }

  const code = generateCode();
  const expiresAt = new Date(
    Date.now() + CODE_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  const { error } = await db.from("withdraw_confirmations").insert({
    owner_id: ownerId,
    code_hash: hash(intentKey(toAddress, amountSol) + ":" + code),
    to_address: toAddress,
    amount_sol: amountSol,
    expires_at: expiresAt,
  });
  if (error) {
    return {
      ok: false,
      sent: false,
      error: "Could not create confirmation: " + error.message,
      expiresInMinutes: CODE_TTL_MINUTES,
    };
  }

  const built = confirmEmail({
    code,
    toAddress,
    amountSol,
    minutes: CODE_TTL_MINUTES,
  });
  // force: true - a security email must ignore alert preferences.
  const result = await sendEmail(email, built, "withdraw_confirm", {
    ownerId,
    force: true,
  });
  if (!result.ok) {
    return {
      ok: false,
      sent: false,
      error: result.error || "Could not send confirmation email.",
      expiresInMinutes: CODE_TTL_MINUTES,
    };
  }

  return { ok: true, sent: true, expiresInMinutes: CODE_TTL_MINUTES };
}

/**
 * Consume a confirmation code. True only for an unused, unexpired code matching
 * this exact destination and amount. Codes are single-use.
 */
export async function consumeWithdrawConfirmation(
  ownerId: string,
  toAddress: string,
  amountSol: number,
  code: string,
): Promise<boolean> {
  const db = getServiceClient();
  if (!db) return false;
  const digest = hash(intentKey(toAddress, amountSol) + ":" + code.trim());
  const { data } = await db
    .from("withdraw_confirmations")
    .select("id, expires_at, used")
    .eq("owner_id", ownerId)
    .eq("code_hash", digest)
    .eq("used", false)
    .maybeSingle();
  if (!data) return false;
  if (new Date(data.expires_at as string).getTime() <= Date.now()) return false;

  // Claim it before returning, so a replay in flight cannot win a race.
  const { data: claimed } = await db
    .from("withdraw_confirmations")
    .update({ used: true, used_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("used", false)
    .select("id");
  return (claimed ?? []).length === 1;
}

export function withdrawConfirmTtlMinutes(): number {
  return CODE_TTL_MINUTES;
}
