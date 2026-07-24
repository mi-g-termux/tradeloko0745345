// GET  /api/admin/config -> current config (secrets masked)  [admin only]
// PUT  /api/admin/config -> update config                    [admin only]
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";
import { invalidateAdminConfigCache } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

function mask(v: string | null): string {
  if (!v) return "";
  if (v.length <= 8) return "••••";
  return v.slice(0, 4) + "…" + v.slice(-4);
}

const SECRET_KEYS = [
  "helius_api_key",
  "birdeye_api_key",
  "x_bearer_token",
  "gemini_api_key",
  "telegram_bot_token",
  "smtp_pass",
];
const PLAIN_KEYS = [
  "auto_buy_enabled",
  "whale_tracking_enabled",
  "x_feed_enabled",
  "ai_enabled",
  "telegram_alerts_enabled",
  "auto_scan_enabled",
  "copy_trade_enabled",
  "launch_feed_enabled",
  "keeper_enabled",
  "telegram_chat_id",
  "whale_wallets",
  "pinned_tokens",
  "fee_enabled",
  "fee_percent",
  "fee_wallet",
  "rpc_url",
  "max_buy_sol",
  "daily_spend_cap_sol",
  "slippage_bps",
  "min_liquidity_usd",
  "require_safe_score",
  "min_signal_confidence",
  "email_notifications_enabled",
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_from",
  "smtp_secure",
];

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 503 });
  const { data } = await db.from("admin_config").select("*").eq("id", 1).maybeSingle();
  if (!data) return NextResponse.json({ config: null });
  const masked = { ...data } as Record<string, unknown>;
  for (const k of SECRET_KEYS) masked[k] = mask((data as Record<string, string>)[k]);
  return NextResponse.json({ config: masked });
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 503 });

  const body = await req.json();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of PLAIN_KEYS) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  // Only overwrite a secret when a real (non-masked) value is supplied.
  for (const k of SECRET_KEYS) {
    const v = body[k];
    if (typeof v === "string" && v && !v.includes("…")) update[k] = v;
  }
  await db.from("admin_config").update(update).eq("id", 1);
  invalidateAdminConfigCache();
  return NextResponse.json({ ok: true });
}
