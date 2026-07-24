// GET  /api/wallet  -> current user's custodial wallet overview
// POST /api/wallet  -> create the wallet if it doesn't exist
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getOrCreateWallet, getWalletOverview } from "@/lib/wallet/custodial";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const overview = await getWalletOverview(user.id);
  return NextResponse.json(overview);
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    await getOrCreateWallet(user.id);
    const overview = await getWalletOverview(user.id);
    return NextResponse.json({ ok: true, ...overview });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
