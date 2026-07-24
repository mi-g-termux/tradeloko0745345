"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import type { WalletActivity } from "@/lib/types";
import { shortAddr, compact, usd } from "@/lib/format";

export default function WhalesPage() {
  const [wallet, setWallet] = useState("");
  const [label, setLabel] = useState("");
  const [rows, setRows] = useState<WalletActivity[]>([]);
  const [needsKey, setNeedsKey] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadTracked() {
    const r = await fetch("/api/whales");
    const j = await r.json();
    setRows(j.results ?? []);
    setNeedsKey(Boolean(j.needsKey));
    setEnabled(j.enabled !== false);
  }
  useEffect(() => {
    loadTracked();
  }, []);

  async function lookup() {
    if (!wallet.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/whales?wallet=${encodeURIComponent(wallet.trim())}`);
      const j = await r.json();
      setRows(j.results ?? []);
      setNeedsKey(Boolean(j.needsKey));
      setEnabled(j.enabled !== false);
    } finally {
      setLoading(false);
    }
  }

  async function track() {
    const r = await fetch("/api/whales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.trim(), label: label.trim() || undefined }),
    });
    const j = await r.json();
    setMsg(r.ok ? { ok: true, text: "Wallet tracked." } : { ok: false, text: j.error ?? "Failed" });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-white">Whale &amp; Copy-Trade Tracker</h1>
      <p className="text-sm text-slate-400">
        Watch what big wallets are buying and selling in real time (on-chain via Helius).
        Add a wallet to your tracked list, or look one up instantly.
      </p>

      {!enabled && (
        <div className="rounded-lg border border-slate-500/20 bg-slate-500/5 px-3 py-2 text-sm text-slate-400">
          Whale tracking is turned <b>off</b>. An admin can enable it in the Admin panel.
        </div>
      )}
      {enabled && needsKey && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
          Whale tracking needs a Helius API key. Add one in the Admin panel (free tier at helius.dev).
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="Wallet address..."
          className="flex-1 min-w-[220px] bg-panel border border-edge rounded-lg px-3 py-2 text-sm font-mono"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="w-40 bg-panel border border-edge rounded-lg px-3 py-2 text-sm"
        />
        <button onClick={lookup} disabled={loading} className="px-3 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
          {loading ? "..." : "Look up"}
        </button>
        <button onClick={track} className="px-3 py-2 rounded-lg text-sm bg-white/10 hover:bg-white/20 text-white">
          Track
        </button>
      </div>
      {msg && (
        <div className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
          {msg.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {msg.text}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full text-sm">
          <thead className="bg-panel text-slate-400 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Wallet</th>
              <th className="text-left px-3 py-2">Action</th>
              <th className="text-left px-3 py-2">Token</th>
              <th className="text-right px-3 py-2">SOL size</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">Market cap now</th>
              <th className="text-right px-3 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.signature} className="border-t border-edge hover:bg-white/5">
                <td className="px-3 py-2 font-mono">{a.label ?? shortAddr(a.wallet)}</td>
                <td className={`px-3 py-2 font-semibold ${a.action === "buy" ? "text-emerald-400" : a.action === "sell" ? "text-red-400" : "text-slate-400"}`}>
                  {a.action.toUpperCase()}
                </td>
                <td className="px-3 py-2">
                  <Link href={`/token/${a.tokenAddress}`} className="text-indigo-400 hover:text-indigo-300">
                    {a.tokenSymbol ? (
                      <span className="font-semibold">{a.tokenSymbol}</span>
                    ) : (
                      <span className="font-mono">{shortAddr(a.tokenAddress)}</span>
                    )}
                    {a.tokenName ? <span className="ml-1 text-slate-500">{a.tokenName}</span> : null}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono">{a.amountSol ? a.amountSol.toFixed(2) : "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{a.priceUsd != null ? usd(a.priceUsd) : "—"}</td>
                <td className="px-3 py-2 text-right">{a.marketCap != null ? compact(a.marketCap) : "—"}</td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {new Date(a.timestamp).toLocaleString()}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  No activity yet. Look up a wallet or add one to track.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Shows each wallet's on-chain buys/sells, trade size in SOL, and the token's
        current price and market cap. Per-trade entry market cap and realized P/L
        require a historical price indexer (paid) and are not shown here.
      </p>
    </div>
  );
}
