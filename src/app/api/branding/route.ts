// GET /api/branding -> public branding (app name, logo, favicon, accent).
// Public on purpose: the navbar and favicon need it before sign-in.
import { NextResponse } from "next/server";
import { getBranding } from "@/lib/branding";

export const dynamic = "force-dynamic";

export async function GET() {
  const branding = await getBranding();
  return NextResponse.json(
    { branding },
    // Short cache: a logo change should show up quickly but we don't want
    // every page view hitting the DB.
    { headers: { "Cache-Control": "public, max-age=30, s-maxage=30" } },
  );
}
