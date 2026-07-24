"use client";
// /account — personal settings: notification email + per-user alert toggles,
// price-condition alerts (notify me when a token goes up 2x / down X%), and the
// Telegram alerts destination. Everything is stored in Supabase. Requires sign-in.
import { useEffect, useState } from "react";
import { BellRing, Mail, Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";

interface Account {
  role: string;
  walletAddress: string | null;
  telegramUsername: string | null;
  telegramChatId: string | null;
  alertsEnabled: boolean;
  email: string | null;
  notifyEmailEnabled: boolean;
  notifyOnBuy: boolean;
  notifyOnSell: boolean;
}

interface PriceAlertRow {
  id: string;
  token_address: string;
  symbol: string | null;
  direction: "up" | "down";
  pct: number;
  label: string | null;
  baseline_price: number | null;
  last_price: number | null;
  enabled: boolean;
  repeat: boolean;
  triggered_at: string | null;
}

const CARD = "rounded-xl border border-[#1a1f2e] bg-[#0f1117] p-4";
const INPUT =
  "w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500/50";

export default function AccountPage() {
  const [acct, setAcct] = useState<Account | null>(null);
  const [chatId, setChatId] = useState("");
  const [alerts, setAlerts] = useState(false);
  const [email, setEmail] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifyBuy, setNotifyBuy] = useState(true);
  const [notifySell, setNotifySell] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  async function load() {
    const res = await fetch("/api/account");
    if (res.status === 401) { setNeedsLogin(true); return; }
    const d = await res.json();
    const a: Account = d.account;
    setAcct(a);
    setChatId(a?.telegramChatId ?? "");
    setAlerts(Boolean(a?.alertsEnabled));
    setEmail(a?.email ?? "");
    setNotifyEmail(Boolean(a?.notifyEmailEnabled));
    setNotifyBuy(a?.notifyOnBuy !== false);
    setNotifySell(a?.notifyOnSell !== false);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setMsg("Saving…");
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegramChatId: chatId.trim(),
        alertsEnabled: alerts,
        email: email.trim(),
        notifyEmailEnabled: notifyEmail,
        notifyOnBuy: notifyBuy,
        notifyOnSell: notifySell,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? "Saved." : "Error: " + (j.error ?? "Save failed."));
  }

  if (needsLogin) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-center">
        <h1 className="text-xl font-semibold text-zinc-100">Sign in required</h1>
        <p className="mt-2 text-sm text-zinc-400">Connect your Solana wallet or Telegram to manage alerts and your watchlist.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-100">Account &amp; alerts</h1>

      {acct && (
        <div className={CARD + " space-y-1 text-sm"}>
          <div className="text-zinc-400">Role: <span className="text-zinc-100">{acct.role}</span></div>
          {acct.walletAddress && <div className="text-zinc-400">Wallet: <span className="font-mono text-zinc-300">{acct.walletAddress.slice(0, 6)}…{acct.walletAddress.slice(-4)}</span></div>}
          {acct.telegramUsername && <div className="text-zinc-400">Telegram: <span className="text-zinc-300">@{acct.telegramUsername}</span></div>}
        </div>
      )}

      {/* Email notifications */}
      <div className={CARD}>
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Mail size={16} className="text-indigo-400" /> Email notifications
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Get an email the moment a trade executes on your account (copy-trade, auto-buy, take-profit / stop-loss),
          including whether a sell closed in profit or loss. This is also where your price alerts below are sent.
        </p>
        <label className="mt-3 block text-xs text-zinc-400">Notification email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={INPUT + " mt-1"} />

        <label className="mt-3 flex items-center gap-2 text-sm text-zinc-200">
          <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="h-4 w-4" />
          Turn on email notifications
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={notifyBuy} onChange={(e) => setNotifyBuy(e.target.checked)} className="h-4 w-4" disabled={!notifyEmail} />
            Notify on buys
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={notifySell} onChange={(e) => setNotifySell(e.target.checked)} className="h-4 w-4" disabled={!notifyEmail} />
            Notify on sells (profit / loss)
          </label>
        </div>
      </div>

      {/* Telegram */}
      <div className={CARD}>
        <label className="block text-sm font-medium text-zinc-200">Telegram chat id</label>
        <p className="mt-1 text-xs text-zinc-500">
          Message your bot, then get your numeric chat id (e.g. from @userinfobot). Watchlist alerts are sent here.
        </p>
        <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="123456789" className={INPUT + " mt-2"} />
        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-200">
          <input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} className="h-4 w-4" />
          Enable personal watchlist alerts
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
          Save settings
        </button>
        {msg && <span className="text-sm text-zinc-400">{msg}</span>}
      </div>

      <PriceAlerts canEmail={notifyEmail && !!email} />
    </main>
  );
}

function PriceAlerts({ canEmail }: { canEmail: boolean }) {
  const [rows, setRows] = useState<PriceAlertRow[] | null>(null);
  const [token, setToken] = useState("");
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [pct, setPct] = useState(100);
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/alerts");
    if (!r.ok) { setRows([]); return; }
    const j = await r.json();
    setRows(j.alerts ?? []);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setErr(null);
    if (!token.trim()) { setErr("Enter a token address."); return; }
    setBusy(true);
    const r = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenAddress: token.trim(), direction, pct, repeat }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "Failed to create."); return; }
    setToken("");
    load();
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    load();
  }

  async function remove(id: string) {
    await fetch("/api/alerts?id=" + encodeURIComponent(id), { method: "DELETE" });
    load();
  }

  const presets: Array<{ label: string; dir: "up" | "down"; pct: number }> = [
    { label: "2x", dir: "up", pct: 100 },
    { label: "5x", dir: "up", pct: 400 },
    { label: "Down 30%", dir: "down", pct: 30 },
    { label: "Down 50%", dir: "down", pct: 50 },
  ];

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <BellRing size={16} className="text-fuchsia-400" /> Price alerts
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Get emailed when a token you care about moves. Pick a target from the current price (captured when you add it).
        {!canEmail && " Add your email and turn on email notifications above to receive these."}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => { setDirection(p.dir); setPct(p.pct); }}
            className={
              "rounded-full border px-3 py-1 text-xs " +
              (direction === p.dir && pct === p.pct
                ? "border-indigo-500 bg-indigo-500/10 text-indigo-200"
                : "border-[#1a1f2e] text-zinc-400 hover:text-zinc-200")
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token mint address" className={INPUT + " font-mono"} />
        <div className="flex flex-wrap items-center gap-2">
          <select value={direction} onChange={(e) => setDirection(e.target.value as "up" | "down")} className={INPUT + " w-auto"}>
            <option value="up">Up</option>
            <option value="down">Down</option>
          </select>
          <div className="flex items-center gap-1">
            <input type="number" value={pct} min={1} step={5} onChange={(e) => setPct(Number(e.target.value))} className={INPUT + " w-24"} />
            <span className="text-sm text-zinc-400">% ({direction === "up" ? "gain" : "drop"})</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="h-4 w-4" />
            Repeat
          </label>
          <button onClick={create} disabled={busy} className="ml-auto flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50">
            <Plus size={14} /> Add alert
          </button>
        </div>
        {err && <div className="text-xs text-red-400">{err}</div>}
      </div>

      <div className="mt-4 space-y-2">
        {!rows && <div className="text-sm text-zinc-500">Loading…</div>}
        {rows && rows.length === 0 && <div className="text-sm text-zinc-500">No price alerts yet.</div>}
        {rows?.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm text-zinc-100">
                {a.direction === "up" ? <TrendingUp size={14} className="text-emerald-400" /> : <TrendingDown size={14} className="text-red-400" />}
                <span className="font-medium">{a.symbol ?? a.token_address.slice(0, 6)}</span>
                <span className="text-zinc-400">{a.label ?? (a.direction === "up" ? "up " + a.pct + "%" : "down " + a.pct + "%")}</span>
                {a.repeat && <span className="rounded bg-[#1a1f2e] px-1.5 py-0.5 text-[10px] text-zinc-400">repeat</span>}
                {a.triggered_at && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">triggered</span>}
              </div>
              <div className="truncate font-mono text-[11px] text-zinc-600">{a.token_address}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => toggle(a.id, !a.enabled)}
                className={
                  "rounded-full px-2 py-1 text-[11px] " +
                  (a.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-600/30 text-slate-400")
                }
              >
                {a.enabled ? "On" : "Off"}
              </button>
              <button onClick={() => remove(a.id)} className="text-zinc-500 hover:text-red-400">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
