// GET /api/wallet/settings  -> auto-trade + withdrawal-safety settings
// PUT /api/wallet/settings  { autoTradeEnabled?, maxBuySol?, dailyCapSol?,
//                             minConfidence?, maxWithdrawSol?,
//                             dailyWithdrawCapSol?, withdrawConfirmRequired?,
//                             withdrawAllowlist? }
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getTradeSettings, saveTradeSettings } from "@/lib/wallet/custodial";
import {
  getWithdrawLimits,
  saveWithdrawLimits,
  withdrawnLast24h,
} from "@/lib/wallet/guards";
import { parseBody, percent, solanaAddress, z } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const [settings, limits, used24h] = await Promise.all([
    getTradeSettings(user.id),
    getWithdrawLimits(user.id),
    withdrawnLast24h(user.id),
  ]);
  return NextResponse.json({ ...settings, ...limits, withdrawnLast24h: used24h });
}

// 0 means "no limit" for the cap fields, so min(0) rather than positive().
const nonNegative = z.number().finite().min(0).max(1000000);

const SettingsSchema = z.object({
  autoTradeEnabled: z.boolean().optional(),
  maxBuySol: nonNegative.optional(),
  dailyCapSol: nonNegative.optional(),
  minConfidence: percent.optional(),
  maxWithdrawSol: nonNegative.optional(),
  dailyWithdrawCapSol: nonNegative.optional(),
  withdrawConfirmRequired: z.boolean().optional(),
  withdrawAllowlist: z.array(solanaAddress).max(50).optional(),
});

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const parsed = await parseBody(req, SettingsSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const tradePatch: Record<string, unknown> = {};
    if (body.autoTradeEnabled !== undefined) {
      tradePatch.autoTradeEnabled = body.autoTradeEnabled;
    }
    if (body.maxBuySol !== undefined) tradePatch.maxBuySol = body.maxBuySol;
    if (body.dailyCapSol !== undefined) tradePatch.dailyCapSol = body.dailyCapSol;
    if (body.minConfidence !== undefined) {
      tradePatch.minConfidence = body.minConfidence;
    }

    const settings = Object.keys(tradePatch).length
      ? await saveTradeSettings(user.id, tradePatch)
      : await getTradeSettings(user.id);

    const limits = await saveWithdrawLimits(user.id, {
      maxWithdrawSol: body.maxWithdrawSol,
      dailyWithdrawCapSol: body.dailyWithdrawCapSol,
      withdrawConfirmRequired: body.withdrawConfirmRequired,
      withdrawAllowlist: body.withdrawAllowlist,
    });

    return NextResponse.json({ ok: true, ...settings, ...limits });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
