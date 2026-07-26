// Admin ads CRUD.
//   GET    /api/admin/ads          -> all creatives + slot catalogue + stats
//   POST   /api/admin/ads          -> create or update a creative
//   DELETE /api/admin/ads?id=...   -> delete a creative
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";
import { AD_SLOTS, isAdSlot, listAllAds, safeLinkUrl } from "@/lib/ads";
import { safeImageUrl } from "@/lib/branding";

export const dynamic = "force-dynamic";

async function guard(): Promise<NextResponse | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const ads = await listAllAds();
  return NextResponse.json({ ads, slots: AD_SLOTS });
}

export async function POST(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 503 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slot = String(b.slot ?? "");
  if (!isAdSlot(slot)) {
    return NextResponse.json({ error: "Pick a valid ad slot." }, { status: 400 });
  }

  const rawImage = b.imageUrl == null ? "" : String(b.imageUrl).trim();
  const rawLink = b.linkUrl == null ? "" : String(b.linkUrl).trim();
  const html = b.html == null ? "" : String(b.html);
  const imageUrl = safeImageUrl(rawImage);
  const linkUrl = safeLinkUrl(rawLink);

  // Reject silently-broken input instead of storing a creative that can never
  // render. Explicit errors are what the old admin panel was missing.
  if (rawImage && !imageUrl) {
    return NextResponse.json(
      { error: "Image URL must be an https:// link, a /path, or a data:image URI." },
      { status: 400 },
    );
  }
  if (rawLink && !linkUrl) {
    return NextResponse.json(
      { error: "Click-through URL must start with http:// or https://" },
      { status: 400 },
    );
  }
  if (!imageUrl && !html.trim()) {
    return NextResponse.json(
      { error: "Add either an image URL or an HTML/script ad snippet." },
      { status: 400 },
    );
  }

  const row = {
    slot,
    title: b.title ? String(b.title).slice(0, 120) : null,
    image_url: imageUrl,
    link_url: linkUrl,
    html: html.trim() ? html : null,
    enabled: b.enabled === undefined ? true : Boolean(b.enabled),
    weight: Math.max(0.1, Math.min(100, Number(b.weight ?? 1) || 1)),
  };

  const id = b.id ? String(b.id) : "";
  if (id) {
    const { error } = await db.from("site_ads").update(row).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id });
  }

  const { data, error } = await db
    .from("site_ads")
    .insert(row)
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id ?? null });
}

export async function DELETE(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 503 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.from("site_ads").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
