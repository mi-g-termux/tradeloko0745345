// POST /api/ads/click  { id } -> records a click, then the browser navigates.
// Public. Deliberately returns 204 with no body so it can be fired from a
// beacon/keepalive fetch without blocking the outbound navigation.
import { NextResponse } from "next/server";
import { recordAdEvent } from "@/lib/ads";
import { clientIp, rateLimit } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Cheap abuse guard so click counters can't be trivially inflated.
  if (!rateLimit(`adclick:${clientIp(req)}`, 60, 60_000)) {
    return new NextResponse(null, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const id = String(body.id ?? "");
  if (id) await recordAdEvent(id, "click");
  return new NextResponse(null, { status: 204 });
}
