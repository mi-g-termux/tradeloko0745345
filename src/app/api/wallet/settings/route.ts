// GET /api/wallet/settings  -> per-user auto-trade settings
// PUT /api/wallet/settings  { autoTradeEnabled?, maxBuySol?, dailyCapSol?, minConfidence? }
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getTradeSettings, saveTradeSettings } from "@/lib/wallet/custodial";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const settings = await getTradeSettings(user.id);
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.autoTradeEnabled === "boolean") patch.autoTradeEnabled = body.autoTradeEnabled;
  if (body.maxBuySol != null) patch.maxBuySol = Math.max(0, Number(body.maxBuySol));
  if (body.dailyCapSol != null) patch.dailyCapSol = Math.max(0, Number(body.dailyCapSol));
  if (body.minConfidence != null) {
    patch.minConfidence = Math.min(100, Math.max(0, Number(body.minConfidence)));
  }
  try {
    const settings = await saveTradeSettings(user.id, patch);
    return NextResponse.json({ ok: true, ...settings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
