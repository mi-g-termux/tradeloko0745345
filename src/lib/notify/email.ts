// SMTP email delivery for MemePump. Uses nodemailer with the SMTP settings from
// the admin panel (admin_config), falling back to env vars. Everything no-ops
// safely (never throws) when email is disabled or unconfigured, and every
// attempt is written to the email_log table for the admin to audit.
import nodemailer, { type Transporter } from "nodemailer";
import { getAdminConfig } from "../adminConfig";
import { getServiceClient } from "../supabase";
import { appBaseUrl } from "../config";
import type { TradeEvent, PriceAlert } from "../types";
import {
  tradeEmail,
  priceAlertEmail,
  testEmail,
  type BuiltEmail,
} from "./emailTemplates";

export interface EmailReadiness {
  enabled: boolean;
  configured: boolean;
}

/** Whether email can currently be delivered (for UI hints). */
export async function emailReady(): Promise<EmailReadiness> {
  const cfg = await getAdminConfig();
  return {
    enabled: cfg.emailNotificationsEnabled,
    configured: Boolean(cfg.smtpHost && cfg.smtpFrom),
  };
}

let cachedTransport: { key: string; t: Transporter } | null = null;

async function getTransport(): Promise<{
  transport: Transporter;
  from: string;
} | null> {
  const cfg = await getAdminConfig();
  if (!cfg.smtpHost || !cfg.smtpFrom) return null;
  const key = [
    cfg.smtpHost,
    cfg.smtpPort,
    cfg.smtpUser,
    cfg.smtpPass,
    cfg.smtpSecure,
  ].join("|");
  if (!cachedTransport || cachedTransport.key !== key) {
    const transport = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort || 587,
      // secure=true for 465 (implicit TLS); false uses STARTTLS on 587/25.
      secure: cfg.smtpSecure || cfg.smtpPort === 465,
      auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass } : undefined,
    });
    cachedTransport = { key, t: transport };
  }
  return { transport: cachedTransport.t, from: cfg.smtpFrom };
}

async function logEmail(row: {
  ownerId?: string | null;
  to: string;
  subject: string;
  kind: string;
  status: "sent" | "failed";
  error?: string | null;
}): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  await db
    .from("email_log")
    .insert({
      owner_id: row.ownerId ?? null,
      to_email: row.to,
      subject: row.subject,
      kind: row.kind,
      status: row.status,
      error: row.error ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * Low-level send. Respects the global admin email toggle (unless `force`, used by
 * the admin test button so the toggle can be verified before switching on).
 */
export async function sendEmail(
  to: string,
  built: BuiltEmail,
  kind: string,
  opts: { ownerId?: string | null; force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!to) return { ok: false, error: "No recipient email." };
  const cfg = await getAdminConfig();
  if (!cfg.emailNotificationsEnabled && !opts.force)
    return { ok: false, error: "Email notifications are disabled." };

  const tp = await getTransport();
  if (!tp) {
    await logEmail({
      ownerId: opts.ownerId,
      to,
      subject: built.subject,
      kind,
      status: "failed",
      error: "SMTP not configured",
    });
    return { ok: false, error: "SMTP not configured." };
  }

  try {
    await tp.transport.sendMail({
      from: tp.from,
      to,
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
    await logEmail({
      ownerId: opts.ownerId,
      to,
      subject: built.subject,
      kind,
      status: "sent",
    });
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message;
    await logEmail({
      ownerId: opts.ownerId,
      to,
      subject: built.subject,
      kind,
      status: "failed",
      error: msg,
    });
    return { ok: false, error: msg };
  }
}

interface UserPrefRow {
  email: string | null;
  notify_email_enabled: boolean | null;
  notify_on_buy: boolean | null;
  notify_on_sell: boolean | null;
}

async function getUserPrefs(ownerId: string): Promise<UserPrefRow | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("app_users")
    .select("email, notify_email_enabled, notify_on_buy, notify_on_sell")
    .eq("id", ownerId)
    .maybeSingle();
  return (data as UserPrefRow) ?? null;
}

/**
 * Notify a user that a trade executed on their account (copy-trade, auto-buy,
 * keeper TP/SL, or a manually-recorded trade). Honors their per-user toggles.
 */
export async function notifyTrade(ev: TradeEvent): Promise<boolean> {
  if (!ev.ownerId) return false;
  const prefs = await getUserPrefs(ev.ownerId);
  if (!prefs?.email || !prefs.notify_email_enabled) return false;
  if (ev.action === "buy" && prefs.notify_on_buy === false) return false;
  if (ev.action === "sell" && prefs.notify_on_sell === false) return false;

  const built = tradeEmail(ev, appBaseUrl());
  const res = await sendEmail(prefs.email, built, "trade", {
    ownerId: ev.ownerId,
  });
  return res.ok;
}

/** Notify a user their price condition was met. */
export async function notifyPriceAlert(
  ownerId: string,
  alert: PriceAlert,
  currentPrice: number,
  changePct: number,
): Promise<boolean> {
  const prefs = await getUserPrefs(ownerId);
  if (!prefs?.email || !prefs.notify_email_enabled) return false;
  const built = priceAlertEmail(alert, currentPrice, changePct, appBaseUrl());
  const res = await sendEmail(prefs.email, built, "price_alert", { ownerId });
  return res.ok;
}

/** Admin test email (bypasses the global toggle so it can be verified first). */
export async function sendTestEmail(
  to: string,
): Promise<{ ok: boolean; error?: string }> {
  return sendEmail(to, testEmail(appBaseUrl()), "test", { force: true });
}
