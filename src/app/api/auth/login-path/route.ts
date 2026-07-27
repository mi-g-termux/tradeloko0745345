// GET /api/auth/login-path
//
// Tells the UI where the admin sign-in page lives, WITHOUT ever revealing a
// private path to someone who does not already know it.
//
// - Default setup  -> { private: false, path: "/signin" }  so /admin can forward.
// - ADMIN_LOGIN_PATH set -> { private: true, path: null }   the caller is told a
//   private door exists but not where it is. Anyone who knows the URL types it
//   directly; anyone who does not learns nothing.
//
// Returning the secret here would defeat the entire point, because the response
// is readable by any unauthenticated visitor.
import { NextResponse } from "next/server";
import { adminLoginIsPrivate, adminLoginSegment } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const isPrivate = adminLoginIsPrivate();
  return NextResponse.json(
    {
      private: isPrivate,
      path: isPrivate ? null : "/" + adminLoginSegment(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
