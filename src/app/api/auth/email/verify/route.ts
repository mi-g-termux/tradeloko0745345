// POST /api/auth/email/verify  { email, code }
// Validates a 6-digit sign-in code and opens a normal session cookie — the same
// session a wallet or Telegram login produces, so every existing permission
// check keeps working unchanged.
import { NextResponse } from "next/server";
import { verifyLoginCode } from "@/lib/auth/emailLogin";
import { setSession } from "@/lib/auth/session";
import { hasSupabase } from "@/lib/config";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/security/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  // Brute-force ceiling on top of the per-code attempt counter.
  const rl = await checkRateLimit({
    bucket: "auth_email_verify",
    identifier: clientIp(req),
    limit: 10,
    windowSec: 900,
  });
  if (!rl.allowed) {
    return tooManyRequests(rl, "Too many code attempts. Try again later.");
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const email = String((body as { email?: unknown }).email ?? "");
  const code = String((body as { code?: unknown }).code ?? "");

  const outcome = await verifyLoginCode(email, code);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  await setSession(outcome.userId);
  return NextResponse.json({ ok: true });
}
