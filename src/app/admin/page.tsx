"use client";
// Admin panel — rebuilt.
//
// The old panel had one flat column of ~40 controls whose only on/off cue was a
// colour. This version fixes the three things that made it unusable:
//   1. Every toggle renders the literal word ON or OFF (see Switch in ui.tsx).
//   2. Settings are grouped into tabs with a live search across all of them.
//   3. A sticky save bar shows unsaved-change count, so nothing is silently lost.
// It also adds the new Branding, Ads and Automation-health sections.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { shortAddr, timeAgo } from "@/lib/format";
import {
  Badge,
  Button,
  Field,
  Modal,
  Switch,
  Tabs,
  TextInput,
  cx,
  inputClass,
} from "@/components/ui";
import type { AdCreative, AdSlotId, CronRunInfo } from "@/lib/types";

/* ───────────────────────────── Config shape ──────────────────────────── */

interface Config {
  auto_buy_enabled: boolean;
  whale_tracking_enabled: boolean;
  whale_wallets: string;
  pinned_tokens: string;
  fee_enabled: boolean;
  fee_percent: number;
  fee_wallet: string;
  x_feed_enabled: boolean;
  ai_enabled: boolean;
  telegram_alerts_enabled: boolean;
  auto_scan_enabled: boolean;
  copy_trade_enabled: boolean;
  launch_feed_enabled: boolean;
  keeper_enabled: boolean;
  helius_api_key: string;
  birdeye_api_key: string;
  x_bearer_token: string;
  gemini_api_key: string;
  openai_api_key: string;
  anthropic_api_key: string;
  groq_api_key: string;
  deepseek_api_key: string;
  ai_council_enabled: boolean;
  telegram_bot_token: string;
  telegram_chat_id: string;
  tg_buy_route: string;
  tg_buy_ref: string;
  tg_buy_template: string;
  rpc_url: string;
  rpc_url_backup: string;
  site_url: string;
  max_buy_sol: number;
  daily_spend_cap_sol: number;
  slippage_bps: number;
  min_liquidity_usd: number;
  require_safe_score: number;
  min_signal_confidence: number;
  email_notifications_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  smtp_from_name: string;
  smtp_secure: boolean;
  // Branding
  brand_name: string;
  logo_url: string;
  favicon_url: string;
  logo_height: number;
  show_brand_name: boolean;
  accent_color: string;
  // Ads
  ads_enabled: boolean;
  // Paid token boosts (our own promotion product)
  boosts_enabled: boolean;
  boost_wallet: string;
  boost_tier1_sol: number;
  boost_tier1_hours: number;
  boost_tier2_sol: number;
  boost_tier2_hours: number;
  boost_tier3_sol: number;
  boost_tier3_hours: number;
}

type TabId =
  | "branding"
  | "automation"
  | "ads"
  | "signals"
  | "alerts"
  | "providers"
  | "trading"
  | "boosts"
  | "members";

const TABS: Array<{ value: TabId; label: string }> = [
  { value: "branding", label: "Branding" },
  { value: "automation", label: "Automation & cron" },
  { value: "ads", label: "Ads" },
  { value: "signals", label: "Signals & risk" },
  { value: "alerts", label: "Alerts" },
  { value: "providers", label: "API keys" },
  { value: "trading", label: "Trading & fees" },
  { value: "boosts", label: "Token boosts" },
  { value: "members", label: "Members" },
];

export default function AdminPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [saved, setSaved] = useState<Config | null>(null);
  const [tab, setTab] = useState<TabId>("branding");
  const [status, setStatus] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/config");
    if (r.status === 403) {
      setForbidden(true);
      return;
    }
    const j = await r.json();
    setCfg(j.config);
    setSaved(j.config);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // /admin is the ONLY entry point to admin email sign-in. The link is
  // deliberately absent from the public nav so regular visitors never see an
  // option they cannot use (and so the admin door is not advertised).
  //
  // Where that door is depends on ADMIN_LOGIN_PATH. If the developer moved it to
  // a private URL, we must NOT forward or link to it - that would hand the secret
  // to anyone who loads /admin. In that case we only say a private URL exists.
  useEffect(() => {
    if (!forbidden) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const r = await fetch("/api/auth/login-path", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (j?.private) {
          setLoginPrivate(true);
          return; // never reveal or navigate to a private path
        }
        const dest: string = j?.path || "/signin";
        setLoginPath(dest);
        timer = setTimeout(() => window.location.replace(dest), 900);
      } catch {
        if (alive) setLoginPrivate(true);
      }
    })();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [forbidden]);

  // Resolved from /api/auth/login-path. Defaults are only used when the site is
  // running on the public /signin door.
  const [loginPath, setLoginPath] = useState("/signin");
  const [loginPrivate, setLoginPrivate] = useState(false);

  const dirtyKeys = useMemo(() => {
    if (!cfg || !saved) return [] as string[];
    return (Object.keys(cfg) as Array<keyof Config>).filter(
      (k) => cfg[k] !== saved[k],
    ) as string[];
  }, [cfg, saved]);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setStatus("Saving…");
    try {
      const r = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      setStatus("Saved. Branding changes appear after a refresh.");
      await load();
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Config>(k: K, v: Config[K]) {
    setCfg((c) => (c ? { ...c, [k]: v } : c));
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-10">
        <div className="card px-4 py-5 text-center">
          <ShieldCheck size={22} className="mx-auto mb-2 text-accent" />
          <h1 className="text-sm font-bold text-ink">Admin sign-in required</h1>
          {loginPrivate ? (
            <p className="mt-1 text-xs text-mute">
              Connect the owner/admin wallet to continue. Email sign-in for this site
              is served from a private URL set by the developer — open that URL
              directly if you need to sign in without your wallet.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-mute">
                Taking you to the sign-in page. Connect the owner/admin wallet, or use
                an emailed code if you are on a device without that wallet.
              </p>
              <a
                href={loginPath}
                className="mt-3 inline-flex items-center justify-center rounded-card bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Continue to sign-in
              </a>
            </>
          )}
        </div>
        <p className="text-center text-2xs text-faint">
          The first person who ever signed in is the permanent owner.
        </p>
      </div>
    );
  }
  if (!cfg) return <div className="text-mute">Loading admin settings…</div>;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-base font-bold text-ink">
          <ShieldCheck size={18} className="text-up" /> Admin panel
        </h1>
        <Badge tone="accent">owner / admin only</Badge>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "branding" ? <BrandingTab cfg={cfg} set={set} /> : null}
      {tab === "automation" ? <AutomationTab cfg={cfg} set={set} /> : null}
      {tab === "ads" ? <AdsTab cfg={cfg} set={set} /> : null}
      {tab === "signals" ? <SignalsTab cfg={cfg} set={set} /> : null}
      {tab === "alerts" ? <AlertsTab cfg={cfg} set={set} /> : null}
      {tab === "providers" ? <ProvidersTab cfg={cfg} set={set} /> : null}
      {tab === "trading" ? <TradingTab cfg={cfg} set={set} /> : null}
      {tab === "boosts" ? <BoostsTab cfg={cfg} set={set} /> : null}
      {tab === "members" ? <Members /> : null}

      {/* ── Sticky save bar: unsaved work can never be lost silently ── */}
      {tab !== "members" && tab !== "ads" ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-panel/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3">
            <span className="text-xs text-mute">
              {dirtyKeys.length === 0
                ? "No unsaved changes."
                : `${dirtyKeys.length} unsaved change${dirtyKeys.length > 1 ? "s" : ""}.`}
            </span>
            {status ? (
              <span className="text-xs text-faint">{status}</span>
            ) : null}
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setCfg(saved)}
                disabled={dirtyKeys.length === 0 || saving}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={save}
                disabled={dirtyKeys.length === 0 || saving}
              >
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────── Shared bits ───────────────────────────── */

type Setter = <K extends keyof Config>(k: K, v: Config[K]) => void;

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {hint ? (
          <p className="mt-1 text-2xs leading-relaxed text-mute">{hint}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Num({
  label,
  value,
  onChange,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputClass}
      />
    </Field>
  );
}

/* ────────────────────────────── Branding ─────────────────────────────── */

function BrandingTab({ cfg, set }: { cfg: Config; set: Setter }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card
        title="Logo & name"
        hint="The logo shows in the top-left of the navbar on every page. Paste an https:// image URL (PNG or SVG with a transparent background works best) or upload the file to /public in your repo and use a path such as /logo.png."
      >
        <Field label="App name" hint="Used in the navbar, page titles and emails.">
          <TextInput
            value={cfg.brand_name ?? ""}
            onChange={(e) => set("brand_name", e.target.value)}
            placeholder="MemePump"
          />
        </Field>

        <Field
          label="Logo URL"
          hint="https://... , /logo.png, or a data:image URI. Anything else is rejected for safety."
        >
          <TextInput
            value={cfg.logo_url ?? ""}
            onChange={(e) => set("logo_url", e.target.value)}
            placeholder="https://yourcdn.com/logo.svg"
          />
        </Field>

        <Num
          label="Logo height (px)"
          value={cfg.logo_height}
          step={1}
          onChange={(v) => set("logo_height", v)}
          hint="14-64. The width scales automatically."
        />

        <Switch
          label="Show app name next to the logo"
          hint="Turn OFF if your logo already contains the wordmark."
          checked={Boolean(cfg.show_brand_name)}
          onChange={(v) => set("show_brand_name", v)}
        />

        {/* Live preview so you can see the result before saving. */}
        <div className="rounded-md border border-edge bg-base p-3">
          <p className="mb-2 text-2xs uppercase tracking-wide text-faint">
            Navbar preview
          </p>
          <div className="flex items-center gap-2">
            {cfg.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cfg.logo_url}
                alt=""
                style={{ height: cfg.logo_height || 28 }}
                className="w-auto object-contain"
              />
            ) : (
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-black text-white">
                {(cfg.brand_name || "M").slice(0, 1).toUpperCase()}
              </span>
            )}
            {(!cfg.logo_url || cfg.show_brand_name) && (
              <span className="text-sm font-bold text-ink">
                {cfg.brand_name || "MemePump"}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Favicon & accent colour"
        hint="The favicon is the small icon in the browser tab. A square 32×32 or 64×64 PNG/SVG works best. If you leave it empty, the logo is used; if that is empty too, the bundled default icon is used."
      >
        <Field label="Favicon URL">
          <TextInput
            value={cfg.favicon_url ?? ""}
            onChange={(e) => set("favicon_url", e.target.value)}
            placeholder="https://yourcdn.com/favicon.png"
          />
        </Field>

        <Field
          label="Accent colour (hex)"
          hint="Recolours buttons, active tabs and highlights across the whole site. Must be a hex value like #16c784."
        >
          <div className="flex gap-2">
            <TextInput
              value={cfg.accent_color ?? ""}
              onChange={(e) => set("accent_color", e.target.value)}
              placeholder="#3b82f6"
            />
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(cfg.accent_color ?? "") ? cfg.accent_color : "#3b82f6"}
              onChange={(e) => set("accent_color", e.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-edge bg-base"
              aria-label="Pick accent colour"
            />
          </div>
        </Field>

        {cfg.favicon_url ? (
          <div className="flex items-center gap-2 rounded-md border border-edge bg-base p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cfg.favicon_url} alt="" className="h-6 w-6 rounded" />
            <span className="text-2xs text-mute">Favicon preview</span>
          </div>
        ) : null}
      </Card>

      <Card
        title="Featured tokens (pinned to the top of the scanner)"
        hint="One token mint address per line, in display order. Leave empty for a pure live list."
      >
        <textarea
          value={cfg.pinned_tokens ?? ""}
          onChange={(e) => set("pinned_tokens", e.target.value)}
          rows={4}
          className={cx(inputClass, "font-mono text-xs")}
          placeholder="So11111111111111111111111111111111111111112"
        />
      </Card>
    </div>
  );
}

/* ───────────────────────── Automation & cron ────────────────────────── */

interface CronPayload {
  cronSecretConfigured: boolean;
  baseUrl: string;
  jobs: CronRunInfo[];
  schedule: Array<{
    job: string;
    label: string;
    description: string;
    everyMinutes: number;
    url: string;
    cronExpression: string;
  }>;
}

function AutomationTab({ cfg, set }: { cfg: Config; set: Setter }) {
  // How many AI providers currently have a key. The council needs at least two
  // independent models before "agreement" means anything.
  const aiKeyCount =
    (cfg.gemini_api_key ? 1 : 0) +
    (cfg.openai_api_key ? 1 : 0) +
    (cfg.anthropic_api_key ? 1 : 0) +
    (cfg.groq_api_key ? 1 : 0) +
    (cfg.deepseek_api_key ? 1 : 0);

  const [data, setData] = useState<CronPayload | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/cron")
      .then((r) => r.json())
      .then((j) => setData(j.error ? null : j))
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  async function scanNow() {
    setScanning(true);
    setScanMsg(null);
    try {
      const r = await fetch("/api/scan/now", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      const res = j.result ?? {};
      setScanMsg(
        `Scanned ${res.scanned ?? 0}, qualified ${res.qualified ?? 0}, alerted ${res.alerted ?? 0}` +
          (res.skippedRecent ? `, skipped ${res.skippedRecent} recent` : "") +
          (res.note ? ` — ${res.note}` : ""),
      );
      load();
    } catch (e) {
      setScanMsg(`Error: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card
        title="Automation switches"
        hint="These decide WHAT the scheduled jobs are allowed to do. The schedule itself lives in cron-job.org (see below) — a job that is turned OFF here still gets called, but returns 'skipped' instead of doing work."
      >
        <div className="grid gap-2 md:grid-cols-2">
          <Switch
            label="Auto-scanner (scheduled signals)"
            hint="The main signal engine. Must be ON for signals to arrive on a schedule."
            checked={cfg.auto_scan_enabled}
            onChange={(v) => set("auto_scan_enabled", v)}
          />
          <Switch
            label="Limit / TP / SL keeper"
            hint="Executes triggered orders."
            checked={cfg.keeper_enabled}
            onChange={(v) => set("keeper_enabled", v)}
          />
          <Switch
            label="Whale tracking"
            hint="Needs a Helius API key."
            checked={cfg.whale_tracking_enabled}
            onChange={(v) => set("whale_tracking_enabled", v)}
            status={
              cfg.whale_tracking_enabled && !cfg.helius_api_key ? (
                <Badge tone="warn">needs Helius key</Badge>
              ) : null
            }
          />
          <Switch
            label="New launch feed"
            checked={cfg.launch_feed_enabled}
            onChange={(v) => set("launch_feed_enabled", v)}
          />
          <Switch
            label="AI analysis (Gemini)"
            hint="Adds a second opinion to each signal."
            checked={cfg.ai_enabled}
            onChange={(v) => set("ai_enabled", v)}
            status={
              cfg.ai_enabled && !cfg.gemini_api_key ? (
                <Badge tone="warn">needs Gemini key</Badge>
              ) : null
            }
          />
          <Switch
            label="AI council (multi-model)"
            hint="Asks every AI provider you configured the same question, in parallel, then compares. Agreement keeps the confidence; disagreement lowers it and the split is shown on the signal."
            checked={cfg.ai_council_enabled}
            onChange={(v) => set("ai_council_enabled", v)}
            status={
              !cfg.ai_enabled ? (
                <Badge tone="warn">turn on AI analysis first</Badge>
              ) : aiKeyCount < 2 ? (
                <Badge tone="warn">add a 2nd AI key</Badge>
              ) : (
                <Badge tone="up">{aiKeyCount} models</Badge>
              )
            }
          />
          <Switch
            label="X / Twitter sentiment"
            checked={cfg.x_feed_enabled}
            onChange={(v) => set("x_feed_enabled", v)}
            status={
              cfg.x_feed_enabled && !cfg.x_bearer_token ? (
                <Badge tone="warn">needs bearer token</Badge>
              ) : null
            }
          />
          <Switch
            label="Copy-trade automation"
            hint="DANGER: spends real SOL from the server signer wallet."
            checked={cfg.copy_trade_enabled}
            onChange={(v) => set("copy_trade_enabled", v)}
          />
          <Switch
            label="Auto-buy (server-signed)"
            hint="DANGER: spends real SOL. Spend caps and the safety gate still apply."
            checked={cfg.auto_buy_enabled}
            onChange={(v) => set("auto_buy_enabled", v)}
          />
        </div>

        {cfg.auto_buy_enabled || cfg.copy_trade_enabled ? (
          <p className="flex items-start gap-1.5 rounded-md border border-down/30 bg-down/5 p-2 text-2xs text-down">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Auto-buy and copy-trade sign transactions with a server-held hot
            wallet (AUTO_BUY_SIGNER_KEY). Fund it only with what you can afford
            to lose.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
          <Button variant="success" onClick={scanNow} disabled={scanning}>
            {scanning ? "Scanning…" : "Run a scan now"}
          </Button>
          {scanMsg ? <span className="text-2xs text-mute">{scanMsg}</span> : null}
        </div>
      </Card>

      {/* ── Health panel: answers "why didn't I get signals?" ── */}
      <Card
        title="Cron health (last 24 hours)"
        hint="Every scheduled job now records a heartbeat. OVERDUE means the job has not been called for more than 2.5x its interval — that points at the cron-job.org entry, not at the app."
      >
        {!data ? (
          <p className="text-xs text-mute">Loading job history…</p>
        ) : (
          <>
            {!data.cronSecretConfigured ? (
              <p className="rounded-md border border-down/30 bg-down/5 p-2 text-2xs text-down">
                CRON_SECRET is not set in your Vercel environment variables. All
                cron endpoints are closed until you set it — that alone stops
                every scheduled signal.
              </p>
            ) : null}

            <div className="overflow-x-auto">
              <table className="dtable">
                <thead>
                  <tr>
                    <th className="text-left">Job</th>
                    <th className="text-left">Last run</th>
                    <th className="text-left">Status</th>
                    <th className="text-right">Every</th>
                    <th className="text-right">Runs 24h</th>
                    <th className="text-right">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.job}>
                      <td className="font-medium text-ink">{j.job}</td>
                      <td className="text-mute">{timeAgo(j.lastRunAt)}</td>
                      <td>
                        {j.lastStatus === "error" ? (
                          <Badge tone="down">error</Badge>
                        ) : j.overdue ? (
                          <Badge tone="warn">overdue</Badge>
                        ) : j.lastStatus === "skipped" ? (
                          <Badge tone="neutral">skipped (off)</Badge>
                        ) : j.lastStatus === "ok" ? (
                          <Badge tone="up">ok</Badge>
                        ) : (
                          <Badge tone="neutral">never run</Badge>
                        )}
                      </td>
                      <td className="text-right text-mute">
                        {j.expectedEveryMinutes}m
                      </td>
                      <td className="text-right">{j.runs24h}</td>
                      <td
                        className={cx(
                          "text-right",
                          j.errors24h ? "text-down" : "text-mute",
                        )}
                      >
                        {j.errors24h}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.jobs.some((j) => j.lastError) ? (
              <div className="space-y-1 border-t border-edge pt-2">
                <p className="text-2xs font-semibold uppercase tracking-wide text-mute">
                  Latest errors
                </p>
                {data.jobs
                  .filter((j) => j.lastError)
                  .map((j) => (
                    <p key={j.job} className="text-2xs text-down">
                      <b>{j.job}</b>: {j.lastError}
                    </p>
                  ))}
              </div>
            ) : null}
          </>
        )}
      </Card>

      <Card
        title="cron-job.org setup"
        hint="Create one cron-job.org job per row. Method GET, and add the header Authorization: Bearer YOUR_CRON_SECRET (or append ?key=YOUR_CRON_SECRET to the URL). Enable its failure notifications so you hear about outages."
      >
        {data ? (
          <div className="space-y-2">
            {data.schedule.map((s) => (
              <div
                key={s.job}
                className="rounded-md border border-edge bg-base p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-ink">
                    {s.label}
                  </span>
                  <Badge tone="accent">every {s.everyMinutes}m</Badge>
                  <code className="text-2xs text-mute">{s.cronExpression}</code>
                  <Button
                    size="xs"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => navigator.clipboard?.writeText(s.url)}
                  >
                    Copy URL
                  </Button>
                </div>
                <code className="mt-1 block break-all text-2xs text-faint">
                  {s.url}
                </code>
                <p className="mt-1 text-2xs text-mute">{s.description}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card
        title="Whale watchlist (smart money)"
        hint="One wallet address per line, with an optional label after the address. Requires whale tracking ON, a Helius key, and Telegram alerts configured."
      >
        <textarea
          value={cfg.whale_wallets ?? ""}
          onChange={(e) => set("whale_wallets", e.target.value)}
          rows={5}
          className={cx(inputClass, "font-mono text-xs")}
          placeholder="So11111111111111111111111111111111111111112  Alpha whale"
        />
      </Card>
    </div>
  );
}

/* ──────────────────────────────── Ads ───────────────────────────────── */

interface SlotInfo {
  id: AdSlotId;
  label: string;
  description: string;
  recommended: string;
}

const BLANK_AD = {
  id: "",
  slot: "top_banner" as AdSlotId,
  title: "",
  imageUrl: "",
  linkUrl: "",
  html: "",
  enabled: true,
  weight: 1,
};

function AdsTab({ cfg, set }: { cfg: Config; set: Setter }) {
  const [ads, setAds] = useState<AdCreative[] | null>(null);
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [draft, setDraft] = useState<typeof BLANK_AD | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/ads")
      .then((r) => r.json())
      .then((j) => {
        setAds(j.ads ?? []);
        setSlots(j.slots ?? []);
      })
      .catch(() => setAds([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The ads master switch saves immediately — this tab has no sticky save bar.
  async function toggleAdsMaster(v: boolean) {
    set("ads_enabled", v);
    await fetch("/api/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ads_enabled: v }),
    });
    setMsg(v ? "Ads are now live on the site." : "Ads hidden site-wide.");
  }

  async function saveAd() {
    if (!draft) return;
    setMsg("Saving…");
    const r = await fetch("/api/admin/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg(`Error: ${j.error ?? "Failed"}`);
      return;
    }
    setMsg("Saved.");
    setDraft(null);
    load();
  }

  async function removeAd(id: string) {
    await fetch(`/api/admin/ads?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    load();
  }

  return (
    <div className="space-y-3">
      <Card
        title="Ads master switch"
        hint="When OFF, no ad markup is sent to the browser at all and the layout collapses as if the slots did not exist."
      >
        <Switch
          label="Show ads on the website"
          checked={Boolean(cfg.ads_enabled)}
          onChange={toggleAdsMaster}
        />
        {msg ? <p className="text-2xs text-mute">{msg}</p> : null}
      </Card>

      <Card
        title="Ad placements"
        hint="Each creative belongs to one slot. If several creatives share a slot, one is chosen per page view using its weight, so you can rotate or A/B them."
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {slots.map((s) => (
            <div key={s.id} className="rounded-md border border-edge bg-base p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">{s.label}</span>
                <Badge tone="neutral">{s.recommended}</Badge>
              </div>
              <p className="mt-1 text-2xs text-mute">{s.description}</p>
              <Button
                size="xs"
                variant="outline"
                className="mt-2"
                onClick={() => setDraft({ ...BLANK_AD, slot: s.id })}
              >
                Add creative
              </Button>
            </div>
          ))}
        </div>

        {ads === null ? (
          <p className="text-xs text-mute">Loading creatives…</p>
        ) : ads.length === 0 ? (
          <p className="text-xs text-mute">
            No ad creatives yet. Pick a slot above to create your first one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th className="text-left">Slot</th>
                  <th className="text-left">Title</th>
                  <th className="text-left">Type</th>
                  <th className="text-left">State</th>
                  <th className="text-right">Weight</th>
                  <th className="text-right">Views</th>
                  <th className="text-right">Clicks</th>
                  <th className="text-right">CTR</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ads.map((a) => (
                  <tr key={a.id}>
                    <td className="text-mute">{a.slot}</td>
                    <td className="text-ink">{a.title ?? "—"}</td>
                    <td className="text-mute">
                      {a.imageUrl ? "image" : "html"}
                    </td>
                    <td>
                      {a.enabled ? (
                        <Badge tone="up">on</Badge>
                      ) : (
                        <Badge tone="neutral">off</Badge>
                      )}
                    </td>
                    <td className="text-right">{a.weight}</td>
                    <td className="text-right">{a.impressions.toLocaleString()}</td>
                    <td className="text-right">{a.clicks.toLocaleString()}</td>
                    <td className="text-right text-mute">
                      {a.impressions > 0
                        ? `${((a.clicks / a.impressions) * 100).toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            setDraft({
                              id: a.id,
                              slot: a.slot,
                              title: a.title ?? "",
                              imageUrl: a.imageUrl ?? "",
                              linkUrl: a.linkUrl ?? "",
                              html: a.html ?? "",
                              enabled: a.enabled,
                              weight: a.weight,
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          variant="danger"
                          onClick={() => removeAd(a.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit ad creative" : "New ad creative"}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveAd}>
              Save creative
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-3">
            <Field label="Slot">
              <select
                value={draft.slot}
                onChange={(e) =>
                  setDraft({ ...draft, slot: e.target.value as AdSlotId })
                }
                className={inputClass}
              >
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} ({s.recommended})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Internal title" hint="Only you see this — used to identify the creative.">
              <TextInput
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Exchange partner — July"
              />
            </Field>

            <Field
              label="Banner image URL"
              hint="Use this for a simple image ad. Leave empty if you are pasting an ad-network snippet below."
            >
              <TextInput
                value={draft.imageUrl}
                onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                placeholder="https://cdn.example.com/banner-728x90.png"
              />
            </Field>

            <Field label="Click-through URL" hint="Where the ad sends the user. Clicks are counted.">
              <TextInput
                value={draft.linkUrl}
                onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
                placeholder="https://partner.example.com/?ref=you"
              />
            </Field>

            <Field
              label="Or paste an ad-network snippet (HTML / script)"
              hint="For Google AdSense, Coinzilla, A-ADS etc. Scripts here execute on the public site — only paste code you trust."
            >
              <textarea
                value={draft.html}
                onChange={(e) => setDraft({ ...draft, html: e.target.value })}
                rows={5}
                className={cx(inputClass, "font-mono text-xs")}
                placeholder='<script async src="https://..."></script>'
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Num
                label="Rotation weight"
                value={draft.weight}
                step={0.5}
                onChange={(v) => setDraft({ ...draft, weight: v })}
                hint="Higher = shown more often when a slot has several creatives."
              />
              <Switch
                label="Creative is active"
                checked={draft.enabled}
                onChange={(v) => setDraft({ ...draft, enabled: v })}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* ────────────────────────── Signals / alerts / keys ──────────────────── */

function SignalsTab({ cfg, set }: { cfg: Config; set: Setter }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card
        title="Signal gates"
        hint="The engine now normalises its score against how much evidence exists, and refuses to issue a directional call on a token with fewer than 20 candles of price history. These thresholds decide what is worth alerting."
      >
        <Num
          label="Min confidence to alert (%)"
          value={cfg.min_signal_confidence}
          step={5}
          onChange={(v) => set("min_signal_confidence", v)}
          hint="55-70 is a sensible band. Higher = fewer, stronger alerts."
        />
        <Num
          label="Required safety score (0-100)"
          value={cfg.require_safe_score}
          step={5}
          onChange={(v) => set("require_safe_score", v)}
        />
        <Num
          label="Min liquidity (USD)"
          value={cfg.min_liquidity_usd}
          step={500}
          onChange={(v) => set("min_liquidity_usd", v)}
          hint="Thin pools produce noisy candles, which is a common cause of bad signals."
        />
      </Card>

      <Card title="Spend rails (auto-buy & copy-trade)">
        <Num
          label="Max SOL per buy"
          value={cfg.max_buy_sol}
          step={0.01}
          onChange={(v) => set("max_buy_sol", v)}
        />
        <Num
          label="Daily spend cap (SOL)"
          value={cfg.daily_spend_cap_sol}
          step={0.1}
          onChange={(v) => set("daily_spend_cap_sol", v)}
        />
        <Num
          label="Slippage (bps)"
          value={cfg.slippage_bps}
          step={10}
          onChange={(v) => set("slippage_bps", v)}
          hint="100 bps = 1%."
        />
      </Card>
    </div>
  );
}

function AlertsTab({ cfg, set }: { cfg: Config; set: Setter }) {
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);

  // Admin login email. This lives on the admin's own user row (app_users.email),
  // NOT in admin_config, because the login code is sent to a person and each
  // admin has their own address. It is edited here so the admin never has to
  // hunt through /account to find it.
  const [adminEmail, setAdminEmail] = useState("");
  const [adminEmailSaved, setAdminEmailSaved] = useState("");
  const [adminEmailMsg, setAdminEmailMsg] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/account", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const j = await r.json();
        const e: string = j?.account?.email ?? "";
        setAdminEmail(e);
        setAdminEmailSaved(e);
      } catch {
        /* leave blank; the field still works */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function saveAdminEmail() {
    setSavingEmail(true);
    setAdminEmailMsg(null);
    try {
      const value = adminEmail.trim();
      const r = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, notifyEmailEnabled: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAdminEmailMsg(j?.error || "Could not save that address.");
        return;
      }
      setAdminEmailSaved(value);
      setAdminEmailMsg(
        value
          ? "Saved. You can now sign in at /signin with this address."
          : "Cleared. Email login is disabled until you set an address.",
      );
    } catch {
      setAdminEmailMsg("Network error. Try again.");
    } finally {
      setSavingEmail(false);
    }
  }
  const [testing, setTesting] = useState(false);

  async function sendTestEmail() {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await fetch("/api/admin/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      setTestMsg("Sent. Check the inbox and the spam folder.");
    } catch (e) {
      setTestMsg(`Error: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Telegram">
        <Switch
          label="Telegram alerts"
          checked={cfg.telegram_alerts_enabled}
          onChange={(v) => set("telegram_alerts_enabled", v)}
          status={
            cfg.telegram_alerts_enabled &&
            !(cfg.telegram_bot_token && cfg.telegram_chat_id) ? (
              <Badge tone="warn">needs token + chat id</Badge>
            ) : null
          }
        />
        <Field label="Bot token" hint="From @BotFather. Paste a new value to change it.">
          <TextInput
            value={cfg.telegram_bot_token ?? ""}
            onChange={(e) => set("telegram_bot_token", e.target.value)}
            className="font-mono"
          />
        </Field>
        <Field label="Broadcast chat ID" hint="e.g. 123456789, or -100... for a group.">
          <TextInput
            value={cfg.telegram_chat_id ?? ""}
            onChange={(e) => set("telegram_chat_id", e.target.value)}
            className="font-mono"
          />
        </Field>

        <div className="mt-3 border-t border-edge pt-3">
          <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-mute">
            Buy button
          </div>
          <Field
            label="Where the Buy button sends people"
            hint="Jupiter is the safe default: it works on every device for every SPL token."
          >
            <select
              className={inputClass}
              value={cfg.tg_buy_route ?? "jupiter"}
              onChange={(e) => set("tg_buy_route", e.target.value)}
            >
              <option value="jupiter">Jupiter (web swap)</option>
              <option value="bonkbot">BONKbot (Telegram, mobile only)</option>
              <option value="trojan">Trojan (Telegram, mobile only)</option>
              <option value="gmgn">GMGN (web)</option>
              <option value="custom">Custom URL template</option>
              <option value="app">This site's trade page</option>
            </select>
          </Field>

          {(cfg.tg_buy_route === "bonkbot" ||
            cfg.tg_buy_route === "trojan") && (
            <div className="mb-2 rounded-card border border-warn/40 bg-warn/10 p-2 text-2xs text-mute">
              Telegram bot deeplinks do not work on Telegram Desktop — that is a
              Telegram limitation, not a bug here. A Jupiter web link is added
              automatically alongside it so desktop readers still have a working
              buy link.
            </div>
          )}

          {cfg.tg_buy_route === "app" && (
            <div className="mb-2 rounded-card border border-warn/40 bg-warn/10 p-2 text-2xs text-mute">
              Requires NEXT_PUBLIC_APP_URL to be set to your public domain. If it
              is unset the button is replaced with a Jupiter link rather than a
              dead localhost link.
            </div>
          )}

          {(cfg.tg_buy_route === "bonkbot" ||
            cfg.tg_buy_route === "trojan" ||
            cfg.tg_buy_route === "custom") && (
            <Field
              label="Referral code (optional)"
              hint="Attached to the buy link so you earn a share of the fees."
            >
              <TextInput
                value={cfg.tg_buy_ref ?? ""}
                onChange={(e) => set("tg_buy_ref", e.target.value)}
                className="font-mono"
                placeholder="yourcode"
              />
            </Field>
          )}

          {cfg.tg_buy_route === "custom" && (
            <Field
              label="URL template"
              hint="Use {ca} for the token mint and {ref} for your referral code."
            >
              <TextInput
                value={cfg.tg_buy_template ?? ""}
                onChange={(e) => set("tg_buy_template", e.target.value)}
                className="font-mono"
                placeholder="https://photon-sol.tinyastro.io/en/r/{ref}/{ca}"
              />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Email (SMTP)" hint="Save first, then send a test. The test bypasses the on/off switch.">
        <Switch
          label="Email notifications"
          checked={cfg.email_notifications_enabled}
          onChange={(v) => set("email_notifications_enabled", v)}
        />
        <Field label="SMTP host">
          <TextInput
            value={cfg.smtp_host ?? ""}
            onChange={(e) => set("smtp_host", e.target.value)}
            placeholder="smtp.resend.com"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Num
            label="SMTP port"
            value={cfg.smtp_port}
            step={1}
            onChange={(v) => set("smtp_port", v)}
          />
          <Switch
            label="Implicit TLS (port 465)"
            checked={cfg.smtp_secure}
            onChange={(v) => set("smtp_secure", v)}
          />
        </div>
        <Field label="SMTP username">
          <TextInput
            value={cfg.smtp_user ?? ""}
            onChange={(e) => set("smtp_user", e.target.value)}
          />
        </Field>
        <Field label="SMTP password" hint="Stored masked. Paste a new value to change it.">
          <TextInput
            value={cfg.smtp_pass ?? ""}
            onChange={(e) => set("smtp_pass", e.target.value)}
            className="font-mono"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="From name"
            hint="The name recipients see in their inbox. Blank uses your app name."
          >
            <TextInput
              value={cfg.smtp_from_name ?? ""}
              onChange={(e) => set("smtp_from_name", e.target.value)}
              placeholder="MemePump Alerts"
            />
          </Field>
          <Field label="From address" hint="Must be a mailbox your SMTP provider allows.">
            <TextInput
              value={cfg.smtp_from ?? ""}
              onChange={(e) => set("smtp_from", e.target.value)}
              placeholder="alerts@yourdomain.com"
            />
          </Field>
        </div>
        <p className="text-2xs text-faint">
          Emails will be sent as{" "}
          <span className="font-mono text-mute">
            {(cfg.smtp_from_name || cfg.brand_name || "MemePump") +
              " <" +
              (cfg.smtp_from || "not-set@yourdomain.com") +
              ">"}
          </span>
        </p>

        <div className="flex gap-2 border-t border-edge pt-3">
          <TextInput
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@example.com"
          />
          <Button
            variant="success"
            onClick={sendTestEmail}
            disabled={testing || !testTo}
          >
            {testing ? "Sending…" : "Send test"}
          </Button>
        </div>
        {testMsg ? <p className="text-2xs text-mute">{testMsg}</p> : null}
      </Card>

      <Card
        title="Admin login email"
        hint="The address that receives your 6-digit sign-in code at /signin. This is how you get in without your wallet."
      >
        <Field
          label="Your admin email address"
          hint="Saved to your own admin account, not shared with other users."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <Button
              onClick={saveAdminEmail}
              disabled={savingEmail || adminEmail.trim() === adminEmailSaved.trim()}
            >
              {savingEmail ? "Saving…" : "Save email"}
            </Button>
          </div>
        </Field>
        {adminEmailMsg ? <p className="text-2xs text-mute">{adminEmailMsg}</p> : null}
        <div className="rounded-card border border-edge bg-panel2 p-3">
          <p className="text-2xs font-medium text-ink">Set this up before you need it</p>
          <ul className="mt-1 space-y-1 text-2xs text-mute">
            <li>1. Save your email above.</li>
            <li>2. Fill in SMTP settings and send yourself a test email.</li>
            <li>
              3. Confirm it arrives. Only then is wallet-free login actually available.
            </li>
          </ul>
          <p className="mt-2 text-2xs text-faint">
            Without working SMTP the code cannot be delivered, so your wallet stays the
            only way in.
          </p>
        </div>
      </Card>
    </div>
  );
}

function ProvidersTab({ cfg, set }: { cfg: Config; set: Setter }) {
  return (
    <Card
      title="Data providers"
      hint="Server-side only — never sent to the browser. Existing values are shown masked; paste a new value to replace one."
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <Field
          label="Public site URL"
          hint="Your real domain, e.g. https://memepumps.vercel.app or https://yourdomain.com. Used for Telegram “Full analysis” buttons and email links. Set this after moving to a custom domain or cPanel — no redeploy needed."
        >
          <TextInput
            value={cfg.site_url ?? ""}
            onChange={(e) => set("site_url", e.target.value)}
            className="font-mono"
            placeholder="https://yourdomain.com"
          />
        </Field>
        <Field label="Solana RPC URL" hint="Helius / Triton / QuickNode. The public RPC is heavily rate-limited and causes 429 errors on Top holders.">
          <TextInput
            value={cfg.rpc_url ?? ""}
            onChange={(e) => set("rpc_url", e.target.value)}
            className="font-mono"
            placeholder="https://mainnet.helius-rpc.com/?api-key=..."
          />
        </Field>
        <Field
          label="Backup Solana RPC URL"
          hint="Tried automatically when the primary returns 429 or is down. Any second provider works."
        >
          <TextInput
            value={cfg.rpc_url_backup ?? ""}
            onChange={(e) => set("rpc_url_backup", e.target.value)}
            className="font-mono"
            placeholder="https://… (optional)"
          />
        </Field>
        <Field label="Helius API key" hint="Whales, holders, launches.">
          <TextInput
            value={cfg.helius_api_key ?? ""}
            onChange={(e) => set("helius_api_key", e.target.value)}
            className="font-mono"
          />
        </Field>
        <Field label="Gemini API key" hint="Free at aistudio.google.com. Powers AI analysis.">
          <TextInput
            value={cfg.gemini_api_key ?? ""}
            onChange={(e) => set("gemini_api_key", e.target.value)}
            className="font-mono"
          />
        </Field>
        <Field label="X / Twitter bearer token" hint="Needed for social sentiment.">
          <TextInput
            value={cfg.x_bearer_token ?? ""}
            onChange={(e) => set("x_bearer_token", e.target.value)}
            className="font-mono"
          />
        </Field>
        <Field label="Birdeye API key" hint="Optional price backup.">
          <TextInput
            value={cfg.birdeye_api_key ?? ""}
            onChange={(e) => set("birdeye_api_key", e.target.value)}
            className="font-mono"
          />
        </Field>
      </div>

      <div className="mt-4 border-t border-edge pt-4">
        <div className="mb-1 text-xs font-semibold text-ink">
          Extra AI providers (AI council)
        </div>
        <p className="mb-3 text-2xs text-mute">
          Add as many as you like. Every key you fill in becomes another
          independent opinion on each signal. When the models agree the
          confidence stands; when they disagree it is cut, and the split is shown
          in the signal. Turn the council on under Automation.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="OpenAI API key" hint="platform.openai.com — gpt-4o-mini. Paid.">
            <TextInput
              value={cfg.openai_api_key ?? ""}
              onChange={(e) => set("openai_api_key", e.target.value)}
              className="font-mono"
              placeholder="sk-…"
            />
          </Field>
          <Field label="Anthropic API key" hint="console.anthropic.com — Claude 3.5 Haiku. Paid.">
            <TextInput
              value={cfg.anthropic_api_key ?? ""}
              onChange={(e) => set("anthropic_api_key", e.target.value)}
              className="font-mono"
              placeholder="sk-ant-…"
            />
          </Field>
          <Field label="Groq API key" hint="console.groq.com — Llama 3.3 70B. Has a free tier.">
            <TextInput
              value={cfg.groq_api_key ?? ""}
              onChange={(e) => set("groq_api_key", e.target.value)}
              className="font-mono"
              placeholder="gsk_…"
            />
          </Field>
          <Field label="DeepSeek API key" hint="platform.deepseek.com — very cheap per call.">
            <TextInput
              value={cfg.deepseek_api_key ?? ""}
              onChange={(e) => set("deepseek_api_key", e.target.value)}
              className="font-mono"
              placeholder="sk-…"
            />
          </Field>
        </div>
      </div>
    </Card>
  );
}

function BoostsTab({ cfg, set }: { cfg: Config; set: Setter }) {
  const ready =
    cfg.boosts_enabled &&
    (cfg.boost_wallet ?? "").trim().length > 0 &&
    [cfg.boost_tier1_sol, cfg.boost_tier2_sol, cfg.boost_tier3_sol].some(
      (v) => Number(v) > 0,
    );

  return (
    <div className="space-y-3">
      <Card
        title="Sell token boosts"
        hint="Token teams pay you to rank at the top of your Trending feed. Payment is verified on-chain before a boost activates, either from the buyer's in-app wallet in one click or from any external wallet by submitting the transaction signature."
      >
        <Switch
          label="Boosts are on sale"
          hint="When off, the /boost page tells visitors that boosts are unavailable."
          checked={cfg.boosts_enabled}
          onChange={(v) => set("boosts_enabled", v)}
        />
        <Field
          label="Boost payout wallet"
          hint="Every boost payment is sent here. Boosts stay disabled until this is set, because taking money with no destination would lose it."
        >
          <TextInput
            value={cfg.boost_wallet ?? ""}
            onChange={(e) => set("boost_wallet", e.target.value)}
            className="font-mono"
            placeholder="Your SOL address"
          />
        </Field>
        {!ready ? (
          <p className="text-2xs text-warn">
            Not live yet: turn boosts on, set a payout wallet, and give at least one package a
            price above 0.
          </p>
        ) : (
          <p className="text-2xs text-mute">
            Live. Buyers can purchase at /boost, and the hourly &quot;Boost expiry&quot; cron job
            retires boosts when their time is up.
          </p>
        )}
      </Card>

      <Card
        title="Packages and pricing"
        hint="You choose the price and the duration. Set a price to 0 to take that package off sale entirely - it is never given away for free."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Num
            label="Starter price (SOL)"
            value={cfg.boost_tier1_sol}
            step={0.1}
            onChange={(v) => set("boost_tier1_sol", v)}
          />
          <Num
            label="Starter duration (hours)"
            value={cfg.boost_tier1_hours}
            step={1}
            onChange={(v) => set("boost_tier1_hours", v)}
          />
          <Num
            label="Growth price (SOL)"
            value={cfg.boost_tier2_sol}
            step={0.1}
            onChange={(v) => set("boost_tier2_sol", v)}
          />
          <Num
            label="Growth duration (hours)"
            value={cfg.boost_tier2_hours}
            step={1}
            onChange={(v) => set("boost_tier2_hours", v)}
          />
          <Num
            label="Headline price (SOL)"
            value={cfg.boost_tier3_sol}
            step={0.1}
            onChange={(v) => set("boost_tier3_sol", v)}
          />
          <Num
            label="Headline duration (hours)"
            value={cfg.boost_tier3_hours}
            step={1}
            onChange={(v) => set("boost_tier3_hours", v)}
          />
        </div>
        <p className="text-2xs text-mute">
          Higher tiers rank above lower ones. Boosted tokens always carry a visible Boosted badge,
          so traders can tell paid placement from organic ranking.
        </p>
      </Card>
    </div>
  );
}

function TradingTab({ cfg, set }: { cfg: Config; set: Setter }) {
  return (
    <Card
      title="Platform trading fee"
      hint="Charged as an extra SOL transfer on in-app custodial trades. Swaps signed by a user's own external wallet cannot be charged."
    >
      <Switch
        label="Charge a platform fee on trades"
        checked={cfg.fee_enabled}
        onChange={(v) => set("fee_enabled", v)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Num
          label="Fee percent (% of trade SOL)"
          value={cfg.fee_percent}
          step={0.1}
          onChange={(v) => set("fee_percent", v)}
        />
        <Field label="Fee destination wallet">
          <TextInput
            value={cfg.fee_wallet ?? ""}
            onChange={(e) => set("fee_wallet", e.target.value)}
            className="font-mono"
            placeholder="Your SOL address"
          />
        </Field>
      </div>
    </Card>
  );
}

/* ────────────────────────────── Members ─────���──────────────────────── */

interface Member {
  id: string;
  wallet_address: string | null;
  telegram_username: string | null;
  display_name: string | null;
  role: string;
  created_at: string;
  last_login_at: string | null;
}

function Members() {
  const [users, setUsers] = useState<Member[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const roles = ["viewer", "trader", "admin", "owner"];

  const load = useCallback(() => {
    fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((j) => setUsers(j.users ?? []))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setRole(userId: string, role: string) {
    setMsg("Updating…");
    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    const j = await r.json();
    setMsg(r.ok ? "Updated." : `Error: ${j.error ?? "Failed"}`);
    load();
  }

  return (
    <Card
      title="Members & roles"
      hint="The first person who ever signed in is the permanent owner. Only an owner can grant admin or owner. Hierarchy: viewer → trader → admin → owner."
    >
      {users === null ? <p className="text-xs text-mute">Loading…</p> : null}
      {users?.length === 0 ? (
        <p className="text-xs text-mute">No members yet.</p>
      ) : null}
      <div className="space-y-1">
        {users?.map((u) => (
          <div
            key={u.id}
            className="flex items-center justify-between gap-2 rounded-md border border-edge bg-base px-3 py-2"
          >
            <div className="min-w-0">
              <span className="block truncate font-mono text-xs text-ink">
                {u.wallet_address
                  ? shortAddr(u.wallet_address)
                  : u.telegram_username
                    ? `@${u.telegram_username}`
                    : (u.display_name ?? u.id.slice(0, 8))}
              </span>
              <span className="text-2xs text-faint">
                last seen {timeAgo(u.last_login_at)}
              </span>
            </div>
            <select
              value={u.role}
              onChange={(e) => setRole(u.id, e.target.value)}
              className="rounded-md border border-edge bg-base px-2 py-1 text-xs"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {msg ? <p className="text-2xs text-mute">{msg}</p> : null}
    </Card>
  );
}
