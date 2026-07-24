// GET /api/portfolio?wallet=<address> — live holdings + PnL for any wallet.
import { NextResponse } from "next/server";
import { getPortfolio } from "@/lib/data/portfolio";
import { getCurrentUser } from "@/lib/auth/session";
import { rateLimit, clientIp } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!rateLimit(`portfolio:${clientIp(req)}`, 15, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  const { searchParams } = new URL(req.url);
  let wallet = searchParams.get("wallet")?.trim() || "";
  if (!wallet) {
    const user = await getCurrentUser();
    wallet = user?.walletAddress ?? "";
  }
  if (!wallet) {
    return NextResponse.json({ error: "Provide ?wallet= or sign in with a wallet." }, { status: 400 });
  }
  try {
    const portfolio = await getPortfolio(wallet);
    return NextResponse.json({ portfolio });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
