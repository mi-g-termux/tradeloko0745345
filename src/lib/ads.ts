// Ad placement engine. Admins create creatives per slot in the admin panel;
// the public site renders the winning creative for a slot and counts
// impressions/clicks. Server-side only (uses the service-role client).
import { getServiceClient } from "./supabase";
import { getAdminConfig } from "./adminConfig";
import { safeImageUrl } from "./branding";
import type { AdCreative, AdSlotId } from "./types";

export const AD_SLOTS: Array<{
  id: AdSlotId;
  label: string;
  description: string;
  recommended: string;
}> = [
  {
    id: "top_banner",
    label: "Top banner",
    description: "Full-width strip directly under the navbar on every page.",
    recommended: "728×90 or 970×90",
  },
  {
    id: "scanner_inline",
    label: "Scanner inline",
    description: "Promoted row inside the scanner table (after the top rows).",
    recommended: "728×90",
  },
  {
    id: "sidebar",
    label: "Sidebar / rail",
    description: "Square unit beside the scanner on wide screens.",
    recommended: "300×250",
  },
  {
    id: "token_page",
    label: "Token page",
    description: "Below the chart on an individual token page.",
    recommended: "728×90",
  },
  {
    id: "footer",
    label: "Footer",
    description: "Bottom of every page.",
    recommended: "728×90",
  },
];

const VALID_SLOTS = new Set<string>(AD_SLOTS.map((s) => s.id));

export function isAdSlot(v: string): v is AdSlotId {
  return VALID_SLOTS.has(v);
}

interface AdRow {
  id: string;
  slot: string;
  title: string | null;
  image_url: string | null;
  link_url: string | null;
  html: string | null;
  enabled: boolean;
  weight: number | null;
  impressions: number | null;
  clicks: number | null;
  created_at?: string;
}

/** Only allow http(s) click-through targets. */
export function safeLinkUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {
    return null;
  }
  return null;
}

function rowToAd(r: AdRow): AdCreative {
  return {
    id: r.id,
    slot: (isAdSlot(r.slot) ? r.slot : "top_banner") as AdSlotId,
    title: r.title,
    imageUrl: safeImageUrl(r.image_url),
    linkUrl: safeLinkUrl(r.link_url),
    html: r.html,
    enabled: Boolean(r.enabled),
    weight: Number(r.weight ?? 1),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    createdAt: r.created_at,
  };
}

/** All creatives (admin view). */
export async function listAllAds(): Promise<AdCreative[]> {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("site_ads")
    .select("*")
    .order("slot", { ascending: true })
    .order("created_at", { ascending: false });
  return ((data as AdRow[] | null) ?? []).map(rowToAd);
}

/**
 * Pick one creative to render for a slot, weighted by `weight`.
 * Returns null when ads are globally disabled or the slot is empty, so the
 * layout can collapse the space entirely (no empty grey boxes).
 */
export async function pickAdForSlot(
  slot: AdSlotId,
): Promise<AdCreative | null> {
  const cfg = await getAdminConfig();
  if (!cfg.adsEnabled) return null;

  const db = getServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("site_ads")
    .select("*")
    .eq("slot", slot)
    .eq("enabled", true);

  const ads = ((data as AdRow[] | null) ?? [])
    .map(rowToAd)
    // A creative is only renderable if it has an image or an HTML body.
    .filter((a) => a.imageUrl || (a.html && a.html.trim()));
  if (ads.length === 0) return null;

  const total = ads.reduce((sum, a) => sum + Math.max(0.0001, a.weight), 0);
  let roll = Math.random() * total;
  for (const ad of ads) {
    roll -= Math.max(0.0001, ad.weight);
    if (roll <= 0) return ad;
  }
  return ads[0];
}

/** Fire-and-forget counter bump. Never blocks or throws into a render path. */
export async function recordAdEvent(
  id: string,
  kind: "impression" | "click",
): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  try {
    // Uses a SQL function so the increment is atomic under concurrency.
    await db.rpc("bump_ad_counter", { ad_id: id, counter: kind });
  } catch {
    // Counters are best-effort telemetry — never surface an error to the user.
  }
}
