// POST /api/auth/siws  { walletAddress, nonce, signature }
// Verifies the wallet signature, creates/loads the user, sets the session.
import { NextRequest, NextResponse } from "next/server";
import { verifySignature } from "@/lib/auth/siws";
import { upsertWalletUser } from "@/lib/auth/users";
import { setSession } from "@/lib/auth/session";
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
  const rl = await checkRateLimit({
    bucket: "auth_siws",
    identifier: clientIp(req),
    limit: 20,
    windowSec: 900,
  });
  if (!rl.allowed) {
    return tooManyRequests(rl, "Too many sign-in attempts. Try again later.");
  }

  const { walletAddress, nonce, signature } = await req.json();
  if (!walletAddress || !nonce || !signature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const ok = await verifySignature(walletAddress, nonce, signature);
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const userId = await upsertWalletUser(walletAddress);
  if (!userId) {
    return NextResponse.json({ error: "Could not create user" }, { status: 500 });
  }
  await setSession(userId);
  return NextResponse.json({ ok: true });
}
