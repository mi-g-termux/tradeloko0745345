// GET /api/features — the capability list for the welcome screen + /features.
import { NextResponse } from "next/server";
import { getFeatures } from "@/lib/features";
import { rateLimit, clientIp } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!rateLimit(`features:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  try {
    const features = await getFeatures();
    return NextResponse.json({ features });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
