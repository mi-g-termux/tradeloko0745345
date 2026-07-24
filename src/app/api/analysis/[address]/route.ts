// GET  /api/analysis/:address -> full signal (technicals + patterns + AI + safety)
// POST /api/analysis/:address -> build signal AND send it to Telegram (admin only)
import { NextRequest, NextResponse } from "next/server";
import { buildSignal } from "@/lib/analysis/signal";
import { broadcastSignal } from "@/lib/notify/telegram";
import { requireAdmin } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } },
) {
  try {
    const signal = await buildSignal(params.address);
    return NextResponse.json({ signal });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { address: string } },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  try {
    const signal = await buildSignal(params.address);
    const sent = await broadcastSignal(signal);
    const db = getServiceClient();
    if (db) {
      await db.from("signals").insert({
        token_address: signal.address,
        symbol: signal.symbol,
        direction: signal.direction,
        confidence: signal.confidence,
        score: signal.score,
        data: signal,
        alerted: sent,
      });
    }
    return NextResponse.json({ signal, sent });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
