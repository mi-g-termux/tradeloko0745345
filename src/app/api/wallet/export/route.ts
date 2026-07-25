// POST /api/wallet/export -> reveal the CURRENT user's own wallet private key.
// Owner-only (session-gated). Returned in the response body only, never logged.
// This is the user's escape hatch: import the key into Phantom/Solflare/Backpack
// and they fully control their funds, independent of this platform.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { exportSecretKey } from "@/lib/wallet/custodial";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const key = await exportSecretKey(user.id);
    return NextResponse.json({ ok: true, ...key });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
