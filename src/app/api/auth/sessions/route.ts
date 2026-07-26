// GET  /api/auth/sessions  -> active sessions for the signed-in user
// POST /api/auth/sessions  { sessionId } | { all: true } | { others: true }
//
// The practical half of revocable sessions: without a way to list and kill
// them, storing sessions in the database would only be bookkeeping.
import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentUser,
  listSessions,
  revokeAllSessions,
  revokeSession,
} from "@/lib/auth/session";
import { parseBody, z } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const sessions = await listSessions(user.id);
  return NextResponse.json({ sessions });
}

const RevokeSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    all: z.boolean().optional(),
    others: z.boolean().optional(),
  })
  .refine(
    (v) => Boolean(v.sessionId || v.all || v.others),
    "Provide sessionId, all, or others.",
  );

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const parsed = await parseBody(req, RevokeSchema);
  if (!parsed.ok) return parsed.response;
  const { sessionId, all, others } = parsed.data;

  if (sessionId) {
    // The user_id filter inside revokeSession prevents revoking someone else's
    // session by guessing an id.
    await revokeSession(user.id, sessionId);
    return NextResponse.json({ ok: true, revoked: 1 });
  }

  const revoked = await revokeAllSessions(user.id, Boolean(others) && !all);
  return NextResponse.json({ ok: true, revoked });
}
