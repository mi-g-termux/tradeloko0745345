// POST /api/wallet/withdraw  { to: string, amountSol: number }
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { withdrawSol } from "@/lib/wallet/custodial";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const to = String(body.to ?? "").trim();
  const amountSol = Number(body.amountSol);
  if (!to) return NextResponse.json({ error: "Destination address required." }, { status: 400 });
  if (!amountSol || amountSol <= 0) {
    return NextResponse.json({ error: "Amount must be greater than 0." }, { status: 400 });
  }
  try {
    const { signature } = await withdrawSol(user.id, to, amountSol);
    return NextResponse.json({ ok: true, signature });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
