// Account settings: notification email, per-user email toggles, Telegram chat id
// + the personal alert toggle. Everything is stored on app_users in Supabase.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const { data } = await db
    .from("app_users")
    .select(
      "telegram_chat_id, alerts_enabled, role, wallet_address, telegram_username, email, notify_email_enabled, notify_on_buy, notify_on_sell",
    )
    .eq("id", user.id)
    .maybeSingle();
  return NextResponse.json({
    account: {
      role: user.role,
      walletAddress: data?.wallet_address ?? null,
      telegramUsername: data?.telegram_username ?? null,
      telegramChatId: data?.telegram_chat_id ?? null,
      alertsEnabled: Boolean(data?.alerts_enabled),
      email: data?.email ?? null,
      notifyEmailEnabled: Boolean(data?.notify_email_enabled),
      notifyOnBuy: data?.notify_on_buy !== false,
      notifyOnSell: data?.notify_on_sell !== false,
    },
  });
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (typeof body.telegramChatId === "string")
    update.telegram_chat_id = body.telegramChatId.trim() || null;
  if (typeof body.alertsEnabled === "boolean") update.alerts_enabled = body.alertsEnabled;

  if (typeof body.email === "string") {
    const email = body.email.trim();
    if (email && !isEmail(email))
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    update.email = email || null;
  }
  if (typeof body.notifyEmailEnabled === "boolean")
    update.notify_email_enabled = body.notifyEmailEnabled;
  if (typeof body.notifyOnBuy === "boolean") update.notify_on_buy = body.notifyOnBuy;
  if (typeof body.notifyOnSell === "boolean") update.notify_on_sell = body.notifyOnSell;

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  await db.from("app_users").update(update).eq("id", user.id);
  return NextResponse.json({ ok: true });
}
