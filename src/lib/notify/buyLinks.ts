// Buy links for Telegram signals.
//
// Why this file exists: the old alert shipped a "Trade" button pointing at
// appBaseUrl() + "/token/<ca>", and appBaseUrl() falls back to
// "http://localhost:3000" whenever NEXT_PUBLIC_APP_URL / APP_URL / VERCEL_URL
// are unset. Telegram renders that button fine, but tapping it on a phone goes
// nowhere, because localhost means the reader's own device. The old keyboard
// also linked "Pump.fun" for every token, which 404s for anything that did not
// launch there.
//
// Rules encoded here:
//  1. Never emit a button whose URL is not publicly reachable. A missing button
//     is better than a dead one.
//  2. Always include at least one web buy link, because Telegram trading-bot
//     deeplinks are documented as NOT working on Telegram Desktop
//     (docs.bonkbot.io/bonkbot/features/deep-links). A bot-only keyboard is
//     exactly why a desktop reader reports "the buy button doesn't work".
//  3. The caller also repeats the buy link as an HTML anchor in the message
//     body, which survives even if the inline keyboard is rejected.

import type { AdminConfig } from "../adminConfig";
import { publicBaseUrl } from "../config";

export type BuyRoute =
  | "jupiter"
  | "bonkbot"
  | "trojan"
  | "gmgn"
  | "custom"
  | "app";

export const BUY_ROUTES: Array<{
  id: BuyRoute;
  label: string;
  kind: "web" | "telegram";
  usesRef: boolean;
  note: string;
}> = [
  {
    id: "jupiter",
    label: "Jupiter (web swap)",
    kind: "web",
    usesRef: false,
    note: "Works on every device and every Solana token. Safest default.",
  },
  {
    id: "bonkbot",
    label: "BONKbot (Telegram)",
    kind: "telegram",
    usesRef: true,
    note: "One-tap buy inside Telegram on mobile. Officially documented deeplink. Does NOT work on Telegram Desktop.",
  },
  {
    id: "trojan",
    label: "Trojan (Telegram)",
    kind: "telegram",
    usesRef: true,
    note: "Mobile-only, same desktop caveat as BONKbot. Send a test alert to confirm your ref code resolves.",
  },
  {
    id: "gmgn",
    label: "GMGN (web)",
    kind: "web",
    usesRef: false,
    note: "Web token page with a buy panel. Works on desktop and mobile.",
  },
  {
    id: "custom",
    label: "Custom URL template",
    kind: "web",
    usesRef: true,
    note: "For Photon, BullX, Axiom, Maestro and friends. Use {ca} for the mint and {ref} for your referral code.",
  },
  {
    id: "app",
    label: "This site's own trade page",
    kind: "web",
    usesRef: false,
    note: "Requires NEXT_PUBLIC_APP_URL to be set to your public domain.",
  },
];

/**
 * Telegram rejects the entire sendMessage call with BUTTON_URL_INVALID if any
 * inline button URL is unusable, which kills the whole alert. So validate every
 * candidate and silently drop the bad ones.
 */
export function isTelegramSafeUrl(raw: string): boolean {
  if (!raw) return false;
  if (raw.length > 2048) return false;
  if (/\s/.test(raw)) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  // Unreachable from anybody else's device.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.endsWith(".local")
  ) {
    return false;
  }
  // Telegram's link parser requires a real TLD.
  if (!host.includes(".")) return false;
  return true;
}

/** Referral codes land in URLs and message text, so keep them boring. */
function cleanRef(ref: string): string {
  return (ref || "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/** A mint we are willing to interpolate into a URL. */
function cleanMint(address: string): string {
  return (address || "").trim().replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
}

export type BuyLink = {
  label: string;
  url: string;
  kind: "web" | "telegram";
};

const JUP = "https://jup.ag/swap/SOL-";
const GMGN = "https://gmgn.ai/sol/token/";
const DEXS = "https://dexscreener.com/solana/";
const BONK = "https://t.me/bonkbot_bot?start=";
const TROJAN = "https://t.me/solana_trojanbot?start=";

/** Jupiter web swap, SOL to token. Any SPL mint, any device, no config. */
export function jupiterBuyUrl(address: string): string {
  return JUP + cleanMint(address);
}

export function gmgnUrl(address: string): string {
  return GMGN + cleanMint(address);
}

export function dexscreenerUrl(address: string): string {
  return DEXS + cleanMint(address);
}

/**
 * BONKbot deeplink. Documented format is ref_<refCode>_ca_<tokenAddress>.
 * With no ref code, deeplink straight to the token instead.
 */
export function bonkbotUrl(address: string, ref: string): string {
  const ca = cleanMint(address);
  const r = cleanRef(ref);
  return r ? BONK + "ref_" + r + "_ca_" + ca : BONK + "ca_" + ca;
}

/** Trojan deeplink. With a ref code the shape is r-<ref>-<mint>. */
export function trojanUrl(address: string, ref: string): string {
  const ca = cleanMint(address);
  const r = cleanRef(ref);
  return r ? TROJAN + "r-" + r + "-" + ca : TROJAN + ca;
}

/** Admin-supplied template, e.g. https://photon-sol.tinyastro.io/en/r/{ref}/{ca} */
export function customUrl(
  template: string,
  address: string,
  ref: string,
): string {
  const ca = cleanMint(address);
  return (template || "")
    .trim()
    .split("{ca}").join(ca)
    .split("{mint}").join(ca)
    .split("{address}").join(ca)
    .split("{ref}").join(cleanRef(ref));
}

function appTradeUrl(address: string): string | null {
  const base = publicBaseUrl();
  if (!base) return null;
  return base + "/token/" + cleanMint(address) + "?action=buy";
}

/**
 * Resolve the buy links for one token, in priority order, already validated.
 *
 * Always returns at least one entry: Jupiter is the guaranteed fallback because
 * it needs no referral code, no bot and no public app URL.
 */
export function buildBuyLinks(
  address: string,
  cfg: Pick<AdminConfig, "tgBuyRoute" | "tgBuyRef" | "tgBuyTemplate">,
): BuyLink[] {
  const ca = cleanMint(address);
  if (!ca) return [];

  const route = (cfg.tgBuyRoute || "jupiter") as BuyRoute;
  const ref = cfg.tgBuyRef || "";
  const out: BuyLink[] = [];

  const push = (label: string, url: string, kind: "web" | "telegram") => {
    if (!isTelegramSafeUrl(url)) return;
    if (out.some((l) => l.url === url)) return;
    out.push({ label, url, kind });
  };

  // 1. The admin's preferred route first.
  switch (route) {
    case "bonkbot":
      push("\u{1F7E2} Buy on BONKbot", bonkbotUrl(ca, ref), "telegram");
      break;
    case "trojan":
      push("\u{1F7E2} Buy on Trojan", trojanUrl(ca, ref), "telegram");
      break;
    case "gmgn":
      push("\u{1F7E2} Buy on GMGN", gmgnUrl(ca), "web");
      break;
    case "custom":
      push("\u{1F7E2} Buy now", customUrl(cfg.tgBuyTemplate || "", ca, ref), "web");
      break;
    case "app": {
      const app = appTradeUrl(ca);
      if (app) push("\u{1F7E2} Buy in app", app, "web");
      break;
    }
    case "jupiter":
    default:
      push("\u{1F7E2} Buy on Jupiter", jupiterBuyUrl(ca), "web");
      break;
  }

  // 2. Guarantee a web-clickable buy link. Telegram-bot deeplinks are dead on
  //    Telegram Desktop, so a bot-only keyboard strands desktop readers.
  if (!out.some((l) => l.kind === "web")) {
    push("\u{1F4B1} Buy on Jupiter", jupiterBuyUrl(ca), "web");
  }

  return out;
}

/** Primary link used for the plain-text anchor inside the message body. */
export function primaryBuyLink(links: BuyLink[]): BuyLink | null {
  return links.find((l) => l.kind === "web") ?? links[0] ?? null;
}
