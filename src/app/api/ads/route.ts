// GET /api/ads?slot=top_banner -> the creative to render in that slot (or null).
// Public. Counts one impression per served creative.
import { NextRequest, NextResponse } from "next/server";
import { isAdSlot, pickAdForSlot, recordAdEvent } from "@/lib/ads";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const slot = req.nextUrl.searchParams.get("slot") ?? "";
  if (!isAdSlot(slot)) {
    return NextResponse.json({ error: "Unknown ad slot" }, { status: 400 });
  }

  const ad = await pickAdForSlot(slot);
  if (ad) void recordAdEvent(ad.id, "impression");

  return NextResponse.json(
    {
      // Only ship what the browser needs to render — never counters.
      ad: ad
        ? {
            id: ad.id,
            slot: ad.slot,
            title: ad.title,
            imageUrl: ad.imageUrl,
            linkUrl: ad.linkUrl,
            html: ad.html,
          }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
