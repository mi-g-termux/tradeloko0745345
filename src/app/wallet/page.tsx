"use client";

// Custodial wallet management (Photon-style): balance, deposit address, quick
// buy/sell, withdraw, private-key backup, and per-user auto-trade settings +
// activity history.
import { useCallback, useEffect, useState } from "react";
import {
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  Check,
  RefreshCw,
  Zap,
  ShoppingCart,
  Banknote,
  AlertTriangle,
  KeyRound,
  Loader2,
} from "lucide-react";

interface Overview {
  ready: boolean;
  exists: boolean;
  publicKey: string | null;
  balanceSol: number;
}
interface Settings {
  autoTradeEnabled: boolean;
  maxBuySol: number;
  dailyCapSol: number;
  minConfidence: number;
}
interface Tx {
  kind: string;
  token_address: string | null;
  sol_amount: number | null;
  signature: string | null;
  status: string | null;
  note: string | null;
  created_at: string;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-panel border border-edge rounded-xl p-4 ${className}`}>{children}</div>
  );
}

export default function WalletPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pk, setPk] = useState<string | null>(null);
  const [pkArray, setPkArray] = useState<string>("");
  const [pkCopied, setPkCopied] = useState(false);

  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [buyToken, setBuyToken] = useState("");
  const [buyAmt, setBuyAmt] = useState("");

  const load = useCallback(async () => {
    const [o, s, t] = await Promise.all([
      fetch("/api/wallet").then((r) => r.json()).catch(() => null),
      fetch("/api/wallet/settings").then((r) => r.json()).catch(() => null),
      fetch("/api/wallet/transactions").then((r) => r.json()).catch(() => ({ transactions: [] })),
    ]);
    if (o && !o.error) setOv(o);
    if (s && !s.error) setSettings(s);
    setTxs(t?.transactions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createWallet() {
    setBusy("create");
    setMsg(null);
    const r = await fetch("/api/wallet", { method: "POST" }).then((x) => x.json());
    setBusy(null);
    if (r.error) setMsg({ ok: false, text: r.error });
    else {
      setMsg({ ok: true, text: "Wallet created. Deposit SOL to start trading." });
      load();
    }
  }

  function copyAddress() {
    if (!ov?.publicKey) return;
    navigator.clipboard.writeText(ov.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function revealKey() {
    setBusy("export");
    setMsg(null);
    const r = await fetch("/api/wallet/export", { method: "POST" }).then((x) => x.json());
    setBusy(null);
    if (r.error) setMsg({ ok: false, text: r.error });
    else {
      setPk(r.base58);
      setPkArray(JSON.stringify(r.array));
    }
  }

  async function doWithdraw() {
    setBusy("withdraw");
    setMsg(null);
    const r = await fetch("/api/wallet/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: withdrawTo, amountSol: Number(withdrawAmt) }),
    }).then((x) => x.json());
    setBusy(null);
    if (r.error) setMsg({ ok: false, text: r.error });
    else {
      setMsg({ ok: true, text: `Withdrawal sent. Tx ${String(r.signature).slice(0, 8)}...` });
      setWithdrawTo("");
      setWithdrawAmt("");
      load();
    }
  }

  async function doTrade(side: "buy" | "sell") {
    setBusy(side);
    setMsg(null);
    const r = await fetch("/api/wallet/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenAddress: buyToken.trim(),
        side,
        amountSol: Number(buyAmt),
      }),
    }).then((x) => x.json());
    setBusy(null);
    if (r.error || r.ok === false) setMsg({ ok: false, text: r.error ?? "Trade failed." });
    else {
      setMsg({ ok: true, text: `${side === "buy" ? "Bought" : "Sold"} — tx ${String(r.signature).slice(0, 8)}...` });
      load();
    }
  }

  async function saveSettings(patch: Partial<Settings>) {
    setBusy("settings");
    const r = await fetch("/api/wallet/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((x) => x.json());
    setBusy(null);
    if (!r.error) setSettings(r);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  if (ov && !ov.ready) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Card className="border-amber-500/40">
          <div className="flex items-start gap-2 text-amber-300">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">In-app wallets are not enabled yet</p>
              <p className="text-sm text-slate-400 mt-1">
                The workspace owner needs to set a <code>WALLET_MASTER_KEY</code>
                {" "}environment variable (a 64-char hex secret) so wallet keys can
                be encrypted. Once set, this page lets anyone create a wallet,
                deposit, trade, and withdraw.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Wallet size={20} className="text-indigo-400" /> My Wallet
        </h1>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            msg.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"
          }`}
        >
          {msg.text}
        </div>
      )}

      {!ov?.exists ? (
        <Card>
          <p className="text-sm text-slate-400 mb-3">
            You don&apos;t have an in-app wallet yet. Create one to deposit SOL and
            trade in a couple of taps — no external wallet needed.
          </p>
          <button
            onClick={createWallet}
            disabled={busy === "create"}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium"
          >
            {busy === "create" ? <Loader2 className="animate-spin" size={16} /> : <Wallet size={16} />}
            Create my wallet
          </button>
        </Card>
      ) : (
        <>
          {/* Balance + deposit */}
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Balance</p>
                <p className="text-3xl font-semibold mt-1">
                  {ov.balanceSol.toFixed(4)} <span className="text-lg text-slate-400">SOL</span>
                </p>
              </div>
              <ArrowDownToLine size={22} className="text-emerald-400" />
            </div>
            <div className="mt-4 border-t border-edge pt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                Deposit address
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-xs bg-base border border-edge rounded-lg px-3 py-2 font-mono">
                  {ov.publicKey}
                </code>
                <button
                  onClick={copyAddress}
                  className="flex items-center gap-1 bg-base border border-edge hover:border-indigo-500 rounded-lg px-3 py-2 text-xs"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Send SOL to this address from any wallet or exchange to fund your
                trading balance.
              </p>
            </div>
          </Card>

          {/* Quick trade */}
          <Card>
            <p className="flex items-center gap-2 font-medium mb-3">
              <ShoppingCart size={16} className="text-indigo-400" /> Quick trade
            </p>
            <input
              value={buyToken}
              onChange={(e) => setBuyToken(e.target.value)}
              placeholder="Token mint address"
              className="w-full bg-base border border-edge rounded-lg px-3 py-2 text-sm font-mono mb-2"
            />
            <div className="flex gap-2">
              <input
                value={buyAmt}
                onChange={(e) => setBuyAmt(e.target.value)}
                placeholder="SOL amount (for buy)"
                inputMode="decimal"
                className="flex-1 bg-base border border-edge rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={() => doTrade("buy")}
                disabled={busy === "buy"}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium"
              >
                {busy === "buy" ? <Loader2 className="animate-spin" size={15} /> : <ShoppingCart size={15} />}
                Buy
              </button>
              <button
                onClick={() => doTrade("sell")}
                disabled={busy === "sell"}
                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium"
              >
                {busy === "sell" ? <Loader2 className="animate-spin" size={15} /> : <Banknote size={15} />}
                Sell all
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Swaps route through Jupiter and are signed by your in-app wallet.
              &quot;Sell all&quot; sells your full balance of that token back to SOL.
            </p>
          </Card>

          {/* Auto-trade */}
          {settings && (
            <Card>
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 font-medium">
                  <Zap size={16} className="text-amber-400" /> Auto-trade
                </p>
                <button
                  onClick={() => saveSettings({ autoTradeEnabled: !settings.autoTradeEnabled })}
                  disabled={busy === "settings"}
                  className={`relative w-11 h-6 rounded-full transition ${
                    settings.autoTradeEnabled ? "bg-emerald-500" : "bg-edge"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                      settings.autoTradeEnabled ? "left-5" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1 mb-3">
                When on, the system automatically buys fresh high-confidence bullish
                signals from your wallet, within the caps below and the admin safety
                gate.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-slate-400">
                  Max / buy (SOL)
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={settings.maxBuySol}
                    onBlur={(e) => saveSettings({ maxBuySol: Number(e.target.value) })}
                    className="w-full mt-1 bg-base border border-edge rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Daily cap (SOL)
                  <input
                    type="number"
                    step="0.1"
                    defaultValue={settings.dailyCapSol}
                    onBlur={(e) => saveSettings({ dailyCapSol: Number(e.target.value) })}
                    className="w-full mt-1 bg-base border border-edge rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Min confidence
                  <input
                    type="number"
                    step="1"
                    defaultValue={settings.minConfidence}
                    onBlur={(e) => saveSettings({ minConfidence: Number(e.target.value) })}
                    className="w-full mt-1 bg-base border border-edge rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                </label>
              </div>
            </Card>
          )}

          {/* Withdraw */}
          <Card>
            <p className="flex items-center gap-2 font-medium mb-3">
              <ArrowUpFromLine size={16} className="text-red-400" /> Withdraw
            </p>
            <input
              value={withdrawTo}
              onChange={(e) => setWithdrawTo(e.target.value)}
              placeholder="Destination SOL address"
              className="w-full bg-base border border-edge rounded-lg px-3 py-2 text-sm font-mono mb-2"
            />
            <div className="flex gap-2">
              <input
                value={withdrawAmt}
                onChange={(e) => setWithdrawAmt(e.target.value)}
                placeholder="SOL amount"
                inputMode="decimal"
                className="flex-1 bg-base border border-edge rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={doWithdraw}
                disabled={busy === "withdraw"}
                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium"
              >
                {busy === "withdraw" ? <Loader2 className="animate-spin" size={15} /> : <ArrowUpFromLine size={15} />}
                Withdraw
              </button>
            </div>
          </Card>

          {/* Backup / export private key */}
          <Card className="border-amber-500/30">
            <p className="flex items-center gap-2 font-medium mb-2">
              <KeyRound size={16} className="text-amber-400" /> Backup private key
            </p>
            <p className="text-xs text-slate-400 mb-3">
              Export your wallet&apos;s private key and import it into Phantom,
              Solflare, or Backpack — then you fully control the funds, independent
              of this site. Whoever has this key owns the wallet: never share it, and
              store it somewhere safe and offline.
            </p>
            {!pk ? (
              <button
                onClick={revealKey}
                disabled={busy === "export"}
                className="flex items-center gap-2 bg-base border border-amber-500/40 hover:border-amber-400 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium text-amber-200"
              >
                {busy === "export" ? <Loader2 className="animate-spin" size={15} /> : <KeyRound size={15} />}
                Reveal private key
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  Anyone with this key can take your funds. Copy it, store it safely,
                  then hide it again.
                </div>
                <code className="block break-all text-xs bg-base border border-edge rounded-lg px-3 py-2 font-mono">
                  {pk}
                </code>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(pk);
                      setPkCopied(true);
                      setTimeout(() => setPkCopied(false), 1500);
                    }}
                    className="flex items-center gap-1 bg-base border border-edge hover:border-indigo-500 rounded-lg px-3 py-1.5 text-xs"
                  >
                    {pkCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    {pkCopied ? "Copied" : "Copy key (Phantom format)"}
                  </button>
                  <button
                    onClick={() => { setPk(null); setPkArray(""); }}
                    className="bg-base border border-edge hover:border-red-500 rounded-lg px-3 py-1.5 text-xs"
                  >
                    Hide
                  </button>
                </div>
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer">Byte-array format (Solana CLI / Solflare)</summary>
                  <code className="block break-all bg-base border border-edge rounded-lg px-3 py-2 font-mono mt-1">
                    {pkArray}
                  </code>
                </details>
              </div>
            )}
          </Card>

          {/* History */}
          <Card>
            <p className="font-medium mb-3">Recent activity</p>
            {txs.length === 0 ? (
              <p className="text-sm text-slate-500">No activity yet.</p>
            ) : (
              <div className="space-y-1.5">
                {txs.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-sm border-b border-edge/60 pb-1.5"
                  >
                    <span className="capitalize text-slate-300">{t.kind}</span>
                    <span className="text-slate-400 font-mono text-xs">
                      {t.sol_amount != null ? `${Number(t.sol_amount).toFixed(4)} SOL` : ""}
                    </span>
                    <span
                      className={`text-xs ${
                        t.status === "failed" ? "text-red-400" : "text-emerald-400"
                      }`}
                    >
                      {t.status ?? "confirmed"}
                    </span>
                    <span className="text-xs text-slate-600">
                      {new Date(t.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
