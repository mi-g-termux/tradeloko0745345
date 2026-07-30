// POST /api/admin/boost -> grant a boost with no payment   [admin only]
//
// For comping a launch partner, apologising for downtime, or promoting the
// admin's own token. Recorded at a price of 0 with granted_by set.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { grantBoost } from "@/lib/boost/boosts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const tokenAddress = String(body.tokenAddress ?? "").trim();
  const tier = Number(body.tier ?? 1);
  const hours = Number(body.hours ?? 0);

  if (!tokenAddress) {
    return NextResponse.json({ error: "Token address required." }, { status: 400 });
  }
  const result = await grantBoost({
    tokenAddress,
    tier,
    hours,
    grantedBy: admin.displayName || admin.walletAddress || admin.id,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
