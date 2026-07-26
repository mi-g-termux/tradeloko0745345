// Branding (logo + favicon + app name) resolved from the admin_config row,
// with env fallbacks. Everything here is PUBLIC-safe: it is served to the
// browser via /api/branding and used in server metadata.
import { getAdminConfig } from "./adminConfig";
import { PUBLIC_ENV } from "./config";
import type { Branding } from "./types";

export const DEFAULT_BRANDING: Branding = {
  appName: PUBLIC_ENV.appName || "MemePump",
  logoUrl: null,
  faviconUrl: null,
  logoHeight: 28,
  showAppNameBesideLogo: true,
  accentColor: null,
};

/**
 * Only allow image URLs we can safely render in <img>/<link rel=icon>.
 * Accepts absolute https URLs, same-origin paths (/logo.png) and data: images.
 * Anything else (javascript:, http: on a https site, etc.) is rejected so an
 * admin field can never become an injection vector.
 */
export function safeImageUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(v))
    return v;
  try {
    const u = new URL(v);
    if (u.protocol === "https:") return u.toString();
  } catch {
    return null;
  }
  return null;
}

/** Validate a hex colour so it can be injected into a CSS variable safely. */
export function safeHexColor(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : null;
}

export async function getBranding(): Promise<Branding> {
  try {
    const cfg = await getAdminConfig();
    return {
      appName: (cfg.brandName || "").trim() || DEFAULT_BRANDING.appName,
      logoUrl: safeImageUrl(cfg.logoUrl),
      faviconUrl: safeImageUrl(cfg.faviconUrl),
      logoHeight:
        Number.isFinite(cfg.logoHeight) && cfg.logoHeight > 0
          ? Math.min(64, Math.max(14, Math.round(cfg.logoHeight)))
          : DEFAULT_BRANDING.logoHeight,
      showAppNameBesideLogo: cfg.showBrandName,
      accentColor: safeHexColor(cfg.accentColor),
    };
  } catch {
    // Never let a missing DB break rendering — fall back to defaults.
    return DEFAULT_BRANDING;
  }
}
