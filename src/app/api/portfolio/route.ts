// GET /api/portfolio?wallet=<address> — live holdings + PnL for any wallet.
import { NextResponse } from "next/server";
import { getPortfolio } from "@/lib/data/portfolio";
import { getCurrentUser } from "@/lib/auth/session";
import { getWalletPublicKey } from "@/lib/wallet/custodial";
import { rateLimit, clientIp } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!rateLimit(`portfolio:${clientIp(req)}`, 15, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("wallet")?.trim() || "";
  const user = await getCurrentUser();

  // Prefer the custodial wallet when the user asked for their own view, so the
  // page shows the balance they actually trade from.
  const ownWallet =
    (user ? await getWalletPublicKey(user.id).catch(() => null) : null) ??
    user?.walletAddress ??
    "";

  const wallet = requested || ownWallet;
  if (!wallet) {
    return NextResponse.json({ error: "Provide ?wallet= or sign in with a wallet." }, { status: 400 });
  }

  // Stats come from our own records, so they are only attached when the caller
  // is looking at their own wallet. Never expose one user's history to another.
  const ownerId = user && wallet === ownWallet ? user.id : undefined;

  try {
    const portfolio = await getPortfolio(wallet, ownerId);
    return NextResponse.json({ portfolio });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
