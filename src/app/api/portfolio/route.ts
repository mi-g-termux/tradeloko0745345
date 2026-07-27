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

  // "My wallet" means the CUSTODIAL wallet - the one this app can actually
  // trade from - and nothing else.
  //
  // This used to fall back to user.walletAddress, the Phantom address someone
  // signed in with. That was wrong. A connected wallet is an IDENTITY, not an
  // account: we cannot sign for it, we hold no cost basis for it, and showing
  // it under "My Wallet" invited people to deposit into an address the trading
  // engine never touches. Two different wallets wearing the same label is a
  // guaranteed support nightmare, so the fallback is gone.
  const ownWallet = user
    ? await getWalletPublicKey(user.id).catch(() => null)
    : null;

  // No address to show is a STATE, not an error. Returning HTTP 400 pushed a
  // developer string ("Provide ?wallet= ...") into the UI as red error text.
  if (!requested) {
    if (!user) {
      return NextResponse.json({ portfolio: null, state: "signed_out" });
    }
    if (!ownWallet) {
      return NextResponse.json({ portfolio: null, state: "no_wallet" });
    }
  }

  const wallet = requested || (ownWallet as string);

  // Stats come from our own records, so they are only attached when the caller
  // is looking at their own wallet. Never expose one user's history to another.
  const ownerId = user && ownWallet && wallet === ownWallet ? user.id : undefined;

  try {
    const portfolio = await getPortfolio(wallet, ownerId);
    return NextResponse.json({
      portfolio,
      state: ownerId ? "ok" : "foreign",
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
