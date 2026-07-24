"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { shortAddr } from "@/lib/format";

interface Config {
  auto_buy_enabled: boolean;
  whale_tracking_enabled: boolean;
  whale_wallets: string;
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
  telegram_bot_token: string;
  telegram_chat_id: string;
  rpc_url: string;
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
  smtp_secure: boolean;
}

export default function AdminPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function load() {
    const r = await fetch("/api/admin/config");
    if (r.status === 403) {
      setForbidden(true);
      return;
    }
    const j = await r.json();
    setCfg(j.config);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!cfg) return;
    setStatus("Saving…");
    const r = await fetch("/api/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    const j = await r.json();
    setStatus(r.ok ? "Saved." : "Error: " + (j.error ?? "Failed"));
    load();
  }

  async function scanNow() {
    setScanning(true);
    setScanMsg(null);
    try {
      const r = await fetch("/api/scan/now", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      const res = j.result;
      setScanMsg(
        `Scanned ${res.scanned}, qualified ${res.qualified}, alerted ${res.alerted}` +
          (res.skippedRecent ? `, skipped ${res.skippedRecent} recent` : "") +
          (res.note ? ` — ${res.note}` : ""),
      );
    } catch (e) {
      setScanMsg("Error: " + (e as Error).message);
    } finally {
      setScanning(false);
    }
  }

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
      setTestMsg("Sent. Check the inbox (and spam folder).");
    } catch (e) {
      setTestMsg("Error: " + (e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  function set<K extends keyof Config>(k: K, v: Config[K]) {
    setCfg((c) => (c ? { ...c, [k]: v } : c));
  }

  if (forbidden) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-red-400">
        Admin access required. Sign in as the owner/admin (the first person who
        signed up is the owner).
      </div>
    );
  }
  if (!cfg) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="flex items-center gap-2 text-lg font-bold text-white">
        <ShieldCheck size={20} className="text-emerald-400" /> Admin Panel
      </h1>

      <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-200/90">
        You can see this panel because you are an owner/admin. The very first
        person to sign in became the permanent <b>owner</b>; new sign-ups are
        always plain viewers, so the admin never changes when others register.
        Manage everyone in <b>Members &amp; roles</b> below.
      </div>

      <Section title="Feature toggles">
        <Toggle label="Whale tracking" on={cfg.whale_tracking_enabled} onChange={(v) => set("whale_tracking_enabled", v)} />
        <Toggle label="Launch feed (new tokens)" on={cfg.launch_feed_enabled} onChange={(v) => set("launch_feed_enabled", v)} />
        <Toggle label="X / Twitter feed (into signal score)" on={cfg.x_feed_enabled} onChange={(v) => set("x_feed_enabled", v)} />
        <Toggle label="AI analysis (Gemini)" on={cfg.ai_enabled} onChange={(v) => set("ai_enabled", v)} />
        <Toggle label="Telegram alerts" on={cfg.telegram_alerts_enabled} onChange={(v) => set("telegram_alerts_enabled", v)} />
        <Toggle label="Auto-scanner (scheduled alerts)" on={cfg.auto_scan_enabled} onChange={(v) => set("auto_scan_enabled", v)} />
        <Toggle label="Limit / TP / SL keeper" on={cfg.keeper_enabled} onChange={(v) => set("keeper_enabled", v)} />
        <Toggle label="Copy-trade automation" on={cfg.copy_trade_enabled} onChange={(v) => set("copy_trade_enabled", v)} danger />
        <Toggle
          label="Auto-buy (server-signed)"
          on={cfg.auto_buy_enabled}
          onChange={(v) => set("auto_buy_enabled", v)}
          danger
        />
        {(cfg.auto_buy_enabled || cfg.copy_trade_enabled) && (
          <p className="flex items-start gap-1.5 text-xs text-red-300/80">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Auto-buy / copy-trade sign transactions with a server-held hot
            wallet (AUTO_BUY_SIGNER_KEY). Fund it with only what you can afford to
            lose. Every buy still passes the safety-score gate and spend caps below.
          </p>
        )}
      </Section>

      <Section title="Auto-scanner">
        <p className="text-xs text-slate-500">
          When enabled, a scheduled job (Vercel Cron, every 15 min) scans trending
          tokens, builds full signals, and sends bullish setups at or above your min
          confidence to Telegram. It de-dupes so the same token isn't spammed.
          Requires Telegram alerts to be configured. You can also run it on demand:
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={scanNow}
            disabled={scanning}
            className="px-3 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Scan now"}
          </button>
          {scanMsg && <span className="text-xs text-slate-300">{scanMsg}</span>}
        </div>
      </Section>

      <Section title="AI analysis">
        <Field label="Gemini API key" value={cfg.gemini_api_key} onChange={(v) => set("gemini_api_key", v)} placeholder="paste to change (free at aistudio.google.com)" />
        <p className="text-xs text-slate-500">
          When on, each token's signal includes a Gemini directional lean + reasoning.
          It's an opinion on real data — never a guarantee.
        </p>
      </Section>

      <Section title="Telegram alerts">
        <Field label="Bot token" value={cfg.telegram_bot_token} onChange={(v) => set("telegram_bot_token", v)} placeholder="from @BotFather (paste to change)" />
        <Field label="Chat ID (where global alerts are sent)" value={cfg.telegram_chat_id} onChange={(v) => set("telegram_chat_id", v)} placeholder="e.g. 123456789 or -100… for a group" />
        <p className="text-xs text-slate-500">
          Use “Send to Telegram” on any token to broadcast its signal. Users set
          their own personal alert chat id on the Account page.
        </p>
      </Section>

      <Section title="Whale watchlist (smart money)">
        <p className="text-xs text-slate-500">
          One wallet address per line, with an optional label after the address
          (for example: So1111... Alpha whale). When any of these wallets buys a
          token, the whale-signal job runs the full analysis and, if the buy is
          bullish and clears your safety and confidence gates, sends a Telegram
          signal tagged with the whale. Requires Whale tracking ON, a Helius key,
          and Telegram alerts configured above.
        </p>
        <textarea
          value={cfg.whale_wallets ?? ""}
          onChange={(e) => set("whale_wallets", e.target.value)}
          rows={5}
          placeholder="So11111111111111111111111111111111111111112  Whale label"
          className="w-full bg-base border border-edge rounded-lg px-3 py-2 text-sm font-mono"
        />
      </Section>

      <Section title="Email notifications (SMTP)">
        <Toggle label="Email notifications" on={cfg.email_notifications_enabled} onChange={(v) => set("email_notifications_enabled", v)} />
        <Field label="SMTP host" value={cfg.smtp_host} onChange={(v) => set("smtp_host", v)} placeholder="e.g. smtp.gmail.com / smtp.resend.com" />
        <NumField label="SMTP port" value={cfg.smtp_port} step={1} onChange={(v) => set("smtp_port", v)} />
        <Toggle label="Use implicit TLS (port 465)" on={cfg.smtp_secure} onChange={(v) => set("smtp_secure", v)} />
        <Field label="SMTP username" value={cfg.smtp_user} onChange={(v) => set("smtp_user", v)} placeholder="SMTP login (often your email)" />
        <Field label="SMTP password" value={cfg.smtp_pass} onChange={(v) => set("smtp_pass", v)} placeholder="paste to change (app password / API key)" />
        <Field label="From address" value={cfg.smtp_from} onChange={(v) => set("smtp_from", v)} placeholder={'"MemePump" <alerts@yourdomain.com>'} />
        <p className="text-xs text-slate-500">
          Users receive trade &amp; price alerts at the email set on their Account page.
          Save first, then send a test to confirm SMTP works (the test bypasses the on/off toggle).
        </p>
        <div className="flex items-center gap-2">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className="flex-1 bg-base border border-edge rounded-lg px-3 py-2 text-sm font-mono" />
          <button onClick={sendTestEmail} disabled={testing || !testTo} className="px-3 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
            {testing ? "Sending…" : "Send test"}
          </button>
        </div>
        {testMsg && <span className="text-xs text-slate-300">{testMsg}</span>}
      </Section>

      <Section title="Data providers (server-side secrets)">
        <Field label="Solana RPC URL" value={cfg.rpc_url} onChange={(v) => set("rpc_url", v)} placeholder="https://… (Helius/Triton/QuickNode)" />
        <Field label="Helius API key (whales, holders)" value={cfg.helius_api_key} onChange={(v) => set("helius_api_key", v)} placeholder="paste to change" />
        <Field label="Birdeye API key (optional)" value={cfg.birdeye_api_key} onChange={(v) => set("birdeye_api_key", v)} placeholder="paste to change" />
        <Field label="X / Twitter bearer token" value={cfg.x_bearer_token} onChange={(v) => set("x_bearer_token", v)} placeholder="paste to change (needed for social feed)" />
      </Section>

      <Section title="Signal & auto-buy risk rails">
        <NumField label="Min signal confidence to alert (%)" value={cfg.min_signal_confidence} step={5} onChange={(v) => set("min_signal_confidence", v)} />
        <NumField label="Max SOL per buy" value={cfg.max_buy_sol} step={0.01} onChange={(v) => set("max_buy_sol", v)} />
        <NumField label="Daily spend cap (SOL)" value={cfg.daily_spend_cap_sol} step={0.1} onChange={(v) => set("daily_spend_cap_sol", v)} />
        <NumField label="Slippage (bps)" value={cfg.slippage_bps} step={10} onChange={(v) => set("slippage_bps", v)} />
        <NumField label="Min liquidity (USD)" value={cfg.min_liquidity_usd} step={500} onChange={(v) => set("min_liquidity_usd", v)} />
        <NumField label="Required safety score (0-100)" value={cfg.require_safe_score} step={5} onChange={(v) => set("require_safe_score", v)} />
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={save} className="px-4 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white">
          Save settings
        </button>
        {status && <span className="text-sm text-slate-300">{status}</span>}
      </div>

      <Members />
    </div>
  );
}

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

  async function load() {
    const r = await fetch("/api/admin/users");
    if (!r.ok) {
      setUsers([]);
      return;
    }
    const j = await r.json();
    setUsers(j.users ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  async function setRole(userId: string, role: string) {
    setMsg("Updating…");
    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    const j = await r.json();
    setMsg(r.ok ? "Updated." : "Error: " + (j.error ?? "Failed"));
    load();
  }

  return (
    <Section title="Members & roles">
      <p className="text-xs text-slate-500">
        The first person to sign in is the <b>owner</b>. Only an owner can grant
        admin/owner. Hierarchy: viewer → trader → admin → owner.
      </p>
      {!users && <div className="text-slate-500 text-sm">Loading…</div>}
      {users && users.length === 0 && (
        <div className="text-slate-500 text-sm">No members yet.</div>
      )}
      {users?.map((u) => (
        <div key={u.id} className="flex items-center justify-between gap-2 border-t border-edge pt-2">
          <span className="text-sm font-mono text-slate-300 truncate">
            {u.wallet_address
              ? shortAddr(u.wallet_address)
              : u.telegram_username
                ? "@" + u.telegram_username
                : u.display_name ?? u.id.slice(0, 8)}
          </span>
          <select
            value={u.role}
            onChange={(e) => setRole(u.id, e.target.value)}
            className="bg-base border border-edge rounded px-2 py-1 text-sm"
          >
            {roles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      ))}
      {msg && <span className="text-xs text-slate-300">{msg}</span>}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-4 space-y-3">
      <div className="text-sm font-bold uppercase tracking-wide text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function Toggle({ label, on, onChange, danger }: { label: string; on: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-200">{label}</span>
      <button
        onClick={() => onChange(!on)}
        className={
          "relative w-11 h-6 rounded-full transition-colors " +
          (on ? (danger ? "bg-red-500" : "bg-emerald-500") : "bg-slate-600")
        }
      >
        <span className={"absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform " + (on ? "translate-x-5" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-base border border-edge rounded-lg px-3 py-2 text-sm font-mono"
      />
    </label>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-base border border-edge rounded-lg px-3 py-2 text-sm font-mono"
      />
    </label>
  );
}
