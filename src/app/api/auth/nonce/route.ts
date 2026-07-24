// GET /api/auth/nonce -> { nonce } for Sign-In-With-Solana
import { NextResponse } from "next/server";
import { issueNonce } from "@/lib/auth/siws";

export const dynamic = "force-dynamic";

export async function GET() {
  const nonce = await issueNonce();
  return NextResponse.json({ nonce });
}
