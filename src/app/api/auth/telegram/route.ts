// POST /api/auth/telegram  (Telegram Login Widget payload)
// Verifies the signed payload, creates/loads the user, sets the session.
import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramLogin, type TelegramAuthData } from "@/lib/auth/telegram";
import { upsertTelegramUser } from "@/lib/auth/users";
import { setSession } from "@/lib/auth/session";
import { hasSupabase } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }
  const data = (await req.json()) as TelegramAuthData;
  if (!verifyTelegramLogin(data)) {
    return NextResponse.json({ error: "Invalid Telegram login" }, { status: 401 });
  }
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ");
  const userId = await upsertTelegramUser(
    String(data.id),
    data.username,
    name || data.username,
  );
  if (!userId) {
    return NextResponse.json({ error: "Could not create user" }, { status: 500 });
  }
  await setSession(userId);
  return NextResponse.json({ ok: true });
}
