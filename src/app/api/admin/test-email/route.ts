// POST /api/admin/test-email -> send a test email to verify SMTP  [admin only]
// Bypasses the global email toggle so the admin can confirm settings BEFORE
// switching notifications on. Uses the SMTP config saved in admin_config.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { sendTestEmail } from "@/lib/notify/email";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const to = String(body.to ?? "").trim();
  if (!to) return NextResponse.json({ error: "Recipient email required" }, { status: 400 });
  const res = await sendTestEmail(to);
  if (!res.ok) return NextResponse.json({ error: res.error ?? "Failed to send" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
