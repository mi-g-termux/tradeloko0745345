// GET /api/wallet/transactions -> recent custodial wallet activity for the user
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const db = getServiceClient();
  if (!db) return NextResponse.json({ transactions: [] });
  const { data } = await db
    .from("wallet_transactions")
    .select("kind, token_address, sol_amount, signature, status, note, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return NextResponse.json({ transactions: data ?? [] });
}
