// POST /api/auth/email/request  { email }
// Sends a 6-digit sign-in code to an ADMIN email address.
//
// Always answers the same way whether or not the address belongs to an admin, so
// the endpoint cannot be used to discover who your admins are. Real failures
// (SMTP down, throttled) are still reported, because an admin waiting for an
// email that will never arrive is worse than a clear error.
import { NextRequest, NextResponse } from "next/server";
import { requestLoginCode, CODE_TTL_MINUTES } from "@/lib/auth/emailLogin";
import { hasSupabase } from "@/lib/config";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/security/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  // Shared-storage limit: 5 code requests per IP per 15 minutes. The library's
  // in-memory counters were per-instance and reset on cold start.
  const rl = await checkRateLimit({
    bucket: "auth_email_request",
    identifier: clientIp(req),
    limit: 5,
    windowSec: 900,
  });
  if (!rl.allowed) {
    return tooManyRequests(rl, "Too many sign-in code requests. Try again later.");
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const email = String((body as { email?: unknown }).email ?? "");

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined;

  const outcome = await requestLoginCode(email, ip);

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json({
    ok: true,
    expiresInMinutes: CODE_TTL_MINUTES,
    message:
      "If that address belongs to an admin account, a 6-digit code is on its way. It expires in " +
      CODE_TTL_MINUTES +
      " minutes.",
  });
}
