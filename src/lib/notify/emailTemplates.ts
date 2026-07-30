// Beautiful, self-contained HTML email templates for MemePump.
// Email clients strip <style>/external CSS and don't run JS, so EVERYTHING is
// inline-styled and table-based. Dark trading-terminal look, no emojis, no dummy
// text. Each builder returns { subject, html, text }.
import type { TradeEvent, PriceAlert } from "../types";
import { usd, shortAddr } from "../format";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = "MemePump";
const BG = "#0a0c10";
const PANEL = "#0f1117";
const EDGE = "#1a1f2e";
const TEXT = "#e2e8f0";
const MUTED = "#7c88a1";
const INDIGO = "#6366f1";
const EMERALD = "#10b981";
const RED = "#ef4444";
const AMBER = "#f59e0b";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtSol(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.abs(n) >= 1 ? n.toFixed(3) : n.toFixed(4);
  return `${v} SOL`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/** Shared shell: header, card, footer. `accent` tints the top bar + button. */
function shell(opts: {
  accent: string;
  preheader: string;
  bodyRows: string;
  ctaLabel?: string;
  ctaUrl?: string;
  appUrl: string;
}): string {
  const { accent, preheader, bodyRows, ctaLabel, ctaUrl, appUrl } = opts;
  const cta =
    ctaLabel && ctaUrl
      ? `<tr><td style="padding:8px 24px 28px 24px;">
          <a href="${esc(ctaUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;">${esc(ctaLabel)}</a>
        </td></tr>`
      : "";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
</head>
<body style="margin:0;padding:0;background:${BG};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${PANEL};border:1px solid ${EDGE};border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="height:4px;background:${accent};"></td></tr>
  <tr><td style="padding:22px 24px 6px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:30px;height:30px;background:${accent};border-radius:8px;color:#fff;font-weight:800;font-size:16px;text-align:center;line-height:30px;">M</td>
      <td style="padding-left:10px;color:${TEXT};font-size:17px;font-weight:700;">${BRAND}</td>
    </tr></table>
  </td></tr>
  ${bodyRows}
  ${cta}
  <tr><td style="padding:16px 24px 22px 24px;border-top:1px solid ${EDGE};">
    <div style="color:${MUTED};font-size:12px;line-height:1.6;">
      You are receiving this because email notifications are enabled on your ${BRAND} account.
      Manage or turn these off anytime in <a href="${esc(appUrl)}/account" style="color:${INDIGO};text-decoration:none;">Account &amp; alerts</a>.
      <br><br>
      Signals and PnL estimates are based on real data but are <b>not</b> financial advice.
      Memecoins are extremely high risk. Trade only what you can afford to lose.
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function statRow(label: string, valueHtml: string): string {
  return `<tr>
    <td style="padding:9px 0;border-bottom:1px solid ${EDGE};color:${MUTED};font-size:13px;">${esc(label)}</td>
    <td style="padding:9px 0;border-bottom:1px solid ${EDGE};color:${TEXT};font-size:13px;text-align:right;font-weight:600;">${valueHtml}</td>
  </tr>`;
}

function pill(text: string, color: string): string {
  return `<span style="display:inline-block;background:${color}22;color:${color};border:1px solid ${color}55;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;letter-spacing:.02em;">${esc(text)}</span>`;
}

/** Trade executed (buy or sell, with profit/loss for sells). */
export function tradeEmail(ev: TradeEvent, appUrl: string): BuiltEmail {
  const isBuy = ev.action === "buy";
  const profit = (ev.pnlSol ?? 0) >= 0;
  const accent = isBuy ? INDIGO : profit ? EMERALD : RED;
  const actionWord = isBuy ? "Bought" : profit ? "Sold at a profit" : "Sold at a loss";
  const headline = isBuy
    ? `Bought ${esc(ev.symbol)}`
    : `Sold ${esc(ev.symbol)} · ${profit ? "profit" : "loss"}`;
  const tokenUrl = `${appUrl}/token/${ev.tokenAddress}`;

  const rows: string[] = [];
  rows.push(statRow("Token", `${esc(ev.symbol)} <span style="color:${MUTED};font-weight:400;">${esc(shortAddr(ev.tokenAddress))}</span>`));
  rows.push(statRow(isBuy ? "Amount spent" : "Proceeds", fmtSol(ev.amountSol)));
  if (ev.priceUsd != null)
    rows.push(statRow("Price", esc(usd(ev.priceUsd))));
  rows.push(statRow("Trigger", pill(ev.source.toUpperCase(), accent)));
  if (ev.reason) rows.push(statRow("Reason", esc(ev.reason)));
  if (!isBuy && ev.pnlSol != null) {
    const pnlColor = profit ? EMERALD : RED;
    rows.push(
      statRow(
        "Profit / loss",
        `<span style="color:${pnlColor};">${profit ? "+" : ""}${fmtSol(ev.pnlSol)}${ev.pnlPct != null ? ` (${fmtPct(ev.pnlPct)})` : ""}</span>`,
      ),
    );
  }
  if (ev.signature)
    rows.push(
      statRow(
        "Transaction",
        `<a href="https://solscan.io/tx/${esc(ev.signature)}" style="color:${INDIGO};text-decoration:none;">${esc(shortAddr(ev.signature))}</a>`,
      ),
    );

  const bodyRows = `
  <tr><td style="padding:6px 24px 2px 24px;">${pill(actionWord, accent)}</td></tr>
  <tr><td style="padding:8px 24px 2px 24px;color:${TEXT};font-size:20px;font-weight:700;">${headline}</td></tr>
  <tr><td style="padding:2px 24px 14px 24px;color:${MUTED};font-size:13px;">${isBuy ? "A buy just executed on your account." : "A position was just closed."}</td></tr>
  <tr><td style="padding:0 24px 8px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>
  </td></tr>`;

  const html = shell({
    accent,
    preheader: `${actionWord}: ${ev.symbol} · ${fmtSol(ev.amountSol)}`,
    bodyRows,
    ctaLabel: "View token",
    ctaUrl: tokenUrl,
    appUrl,
  });

  const textLines = [
    `${BRAND} — ${actionWord}`,
    `${ev.symbol} (${ev.tokenAddress})`,
    `${isBuy ? "Spent" : "Proceeds"}: ${fmtSol(ev.amountSol)}`,
    ev.priceUsd != null ? `Price: ${usd(ev.priceUsd)}` : "",
    `Trigger: ${ev.source}`,
    ev.reason ? `Reason: ${ev.reason}` : "",
    !isBuy && ev.pnlSol != null
      ? `PnL: ${ev.pnlSol >= 0 ? "+" : ""}${fmtSol(ev.pnlSol)}${ev.pnlPct != null ? ` (${fmtPct(ev.pnlPct)})` : ""}`
      : "",
    ev.signature ? `Tx: https://solscan.io/tx/${ev.signature}` : "",
    `View: ${tokenUrl}`,
  ].filter(Boolean);

  return { subject: `${isBuy ? "Buy" : profit ? "Profit" : "Loss"} — ${ev.symbol} on ${BRAND}`, html, text: textLines.join("\n") };
}

/** A user-defined price condition was met. */
export function priceAlertEmail(
  alert: PriceAlert,
  currentPrice: number,
  changePct: number,
  appUrl: string,
): BuiltEmail {
  const up = alert.direction === "up";
  const accent = up ? EMERALD : RED;
  const sym = alert.symbol ?? shortAddr(alert.tokenAddress);
  const cond = alert.label ?? (up ? `up ${alert.pct}%` : `down ${alert.pct}%`);
  const tokenUrl = `${appUrl}/token/${alert.tokenAddress}`;

  const rows = [
    statRow("Token", `${esc(sym)} <span style="color:${MUTED};font-weight:400;">${esc(shortAddr(alert.tokenAddress))}</span>`),
    statRow("Your condition", pill(cond, accent)),
    statRow("Move since you set it", `<span style="color:${accent};">${fmtPct(changePct)}</span>`),
    statRow("Current price", esc(usd(currentPrice))),
    alert.baselinePrice != null ? statRow("Baseline price", esc(usd(alert.baselinePrice))) : "",
  ].join("");

  const bodyRows = `
  <tr><td style="padding:6px 24px 2px 24px;">${pill("Price alert", accent)}</td></tr>
  <tr><td style="padding:8px 24px 2px 24px;color:${TEXT};font-size:20px;font-weight:700;">${esc(sym)} is ${up ? "up" : "down"} ${esc(cond)}</td></tr>
  <tr><td style="padding:2px 24px 14px 24px;color:${MUTED};font-size:13px;">Your price condition just triggered. Here is where it stands right now.</td></tr>
  <tr><td style="padding:0 24px 8px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr>`;

  const html = shell({
    accent,
    preheader: `${sym} ${up ? "up" : "down"} ${cond} — now ${usd(currentPrice)}`,
    bodyRows,
    ctaLabel: "Open token",
    ctaUrl: tokenUrl,
    appUrl,
  });

  const text = [
    `${BRAND} price alert`,
    `${sym} (${alert.tokenAddress})`,
    `Condition: ${cond}`,
    `Move: ${fmtPct(changePct)}`,
    `Current: ${usd(currentPrice)}`,
    alert.baselinePrice != null ? `Baseline: ${usd(alert.baselinePrice)}` : "",
    `Open: ${tokenUrl}`,
  ].filter(Boolean).join("\n");

  return { subject: `${sym} hit your ${cond} alert — ${BRAND}`, html, text };
}

/** Admin test email to confirm SMTP works. */
export function testEmail(appUrl: string): BuiltEmail {
  const bodyRows = `
  <tr><td style="padding:6px 24px 2px 24px;">${pill("SMTP test", EMERALD)}</td></tr>
  <tr><td style="padding:8px 24px 2px 24px;color:${TEXT};font-size:20px;font-weight:700;">Your email settings work</td></tr>
  <tr><td style="padding:2px 24px 16px 24px;color:${MUTED};font-size:13px;line-height:1.6;">
    This is a test message from your ${BRAND} admin panel. If you can read this, your SMTP host,
    credentials, and “from” address are configured correctly and users will receive trade and
    price-alert notifications.
  </td></tr>`;
  const html = shell({
    accent: EMERALD,
    preheader: `${BRAND} SMTP test — it works`,
    bodyRows,
    ctaLabel: "Open dashboard",
    ctaUrl: appUrl,
    appUrl,
  });
  return {
    subject: `${BRAND} SMTP test — success`,
    html,
    text: `${BRAND} SMTP test succeeded. Your email notifications are configured correctly.`,
  };
}

/**
 * Sign-in code (admin login from any device, no wallet required).
 *
 * Deliberately plain: one big code, an expiry, and a warning. No CTA button,
 * because a click-to-login link in email can be followed by scanners/proxies
 * and would let anyone with inbox access in silently. A typed code requires
 * a human.
 */
/** A paid or granted token boost just went live. */
export function boostConfirmedEmail(opts: {
  tokenAddress: string;
  tierName: string;
  priceSol: number;
  hours: number;
  expiresAt: string;
  reference: string;
  signature: string | null;
  appUrl: string;
}): BuiltEmail {
  const accent = EMERALD;
  const tokenUrl = `${opts.appUrl}/token/${opts.tokenAddress}`;
  const paid = opts.priceSol > 0 ? fmtSol(opts.priceSol) : "Granted by the team";
  const until = new Date(opts.expiresAt).toUTCString();

  const rows: string[] = [];
  rows.push(statRow("Token", esc(shortAddr(opts.tokenAddress))));
  rows.push(statRow("Package", `${esc(opts.tierName)} · ${opts.hours}h`));
  rows.push(statRow("Paid", esc(paid)));
  rows.push(statRow("Runs until", esc(until)));
  rows.push(statRow("Reference", esc(opts.reference)));
  if (opts.signature && !opts.signature.startsWith("charge:")) {
    rows.push(statRow("Transaction", esc(shortAddr(opts.signature))));
  }

  const bodyRows = `
  <tr><td style="padding:6px 24px 2px 24px;">${pill("Boost active", accent)}</td></tr>
  <tr><td style="padding:8px 24px 2px 24px;color:${TEXT};font-size:20px;font-weight:700;">Your boost is live</td></tr>
  <tr><td style="padding:2px 24px 14px 24px;color:${MUTED};font-size:13px;">Payment cleared and the token is now promoted in the trending feed.</td></tr>
  <tr><td style="padding:0 24px 8px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>
  </td></tr>`;

  const html = shell({
    accent,
    preheader: `Boost active · ${opts.tierName} · ${opts.hours}h`,
    bodyRows,
    ctaLabel: "View your boost",
    ctaUrl: tokenUrl,
    appUrl: opts.appUrl,
  });

  const textLines = [
    `${BRAND} - your boost is live`,
    `Token: ${opts.tokenAddress}`,
    `Package: ${opts.tierName} (${opts.hours}h)`,
    `Paid: ${paid}`,
    `Runs until: ${until}`,
    `Reference: ${opts.reference}`,
    `View: ${tokenUrl}`,
  ];

  return {
    subject: `Your ${opts.tierName} boost is live on ${BRAND}`,
    html,
    text: textLines.join(String.fromCharCode(10)),
  };
}

export function loginCodeEmail(opts: {
  code: string;
  appUrl: string;
  minutes: number;
}): BuiltEmail {
  const { code, appUrl, minutes } = opts;
  const bodyRows = `
  <tr><td style="padding:6px 24px 2px 24px;">${pill("Sign-in code", INDIGO)}</td></tr>
  <tr><td style="padding:8px 24px 2px 24px;color:${TEXT};font-size:20px;font-weight:700;">Your ${BRAND} sign-in code</td></tr>
  <tr><td style="padding:2px 24px 10px 24px;color:${MUTED};font-size:13px;line-height:1.6;">
    Enter this code on the sign-in page to access your account. It expires in
    ${esc(minutes)} minutes and can only be used once.
  </td></tr>
  <tr><td style="padding:6px 24px 18px 24px;">
    <div style="background:${BG};border:1px solid ${EDGE};border-radius:12px;padding:18px;text-align:center;color:${TEXT};font-size:32px;font-weight:800;letter-spacing:.28em;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">${esc(code)}</div>
  </td></tr>
  <tr><td style="padding:0 24px 18px 24px;color:${MUTED};font-size:12px;line-height:1.6;">
    <b style="color:${AMBER};">If you did not request this,</b> ignore this email — nothing has changed and
    no one can access your account without this code. If you keep receiving codes you did not
    request, someone knows your email address: change it in Account &amp; alerts.
  </td></tr>`;
  const html = shell({
    accent: INDIGO,
    preheader: `Your ${BRAND} sign-in code: ${code}`,
    bodyRows,
    appUrl,
  });
  return {
    subject: `${BRAND} sign-in code: ${code}`,
    html,
    text: `Your ${BRAND} sign-in code is ${code}. It expires in ${minutes} minutes and can only be used once. If you did not request it, ignore this email.`,
  };
}
