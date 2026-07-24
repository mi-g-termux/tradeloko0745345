"use client";
// /launches — new-launch radar (feature #1).
import { useEffect, useState } from "react";
import LiveLaunches from "@/components/LiveLaunches";

interface LaunchToken {
  address: string; symbol: string; name: string; ageMinutes: number | null;
  liquidityUsd: number | null; priceUsd: number | null; isPumpFun: boolean;
  safetyScore: number | null; url: string | null;
}

function usd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toPrecision(3)}`;
}

export default function LaunchesPage() {
  const [rows, setRows] = useState<LaunchToken[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const d = await fetch("/api/launches?limit=40").then((r) => r.json());
      setRows(d.launches ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">New launch radar</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Freshly-indexed Solana tokens with an instant safety pre-screen on the newest few. The live
        feed below streams pump.fun creations in real time.
      </p>
      <LiveLaunches />
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-300">Recently indexed</h2>
        <button onClick={load} className="text-xs text-zinc-400 underline hover:text-zinc-200">Refresh</button>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-[#1a1f2e]">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1117] text-left text-xs uppercase text-zinc-500">
            <tr><th className="px-3 py-2">Token</th><th className="px-3 py-2">Age</th><th className="px-3 py-2">Liquidity</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Safety</th></tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Loading…</td></tr>}
            {rows.map((r) => (
              <tr key={r.address} className="border-t border-[#1a1f2e] hover:bg-[#0f1117]">
                <td className="px-3 py-2">
                  <a href={`/token/${r.address}`} className="font-medium text-zinc-100 hover:underline">{r.symbol || r.address.slice(0, 6)}</a>
                  {r.isPumpFun && <span className="ml-2 rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] text-fuchsia-400">pump.fun</span>}
                </td>
                <td className="px-3 py-2 text-zinc-400">{r.ageMinutes != null ? `${r.ageMinutes}m` : "—"}</td>
                <td className="px-3 py-2 text-zinc-400">{usd(r.liquidityUsd)}</td>
                <td className="px-3 py-2 text-zinc-400">{usd(r.priceUsd)}</td>
                <td className="px-3 py-2">
                  {r.safetyScore == null ? <span className="text-zinc-600">—</span> : <span className={r.safetyScore >= 70 ? "text-emerald-400" : r.safetyScore >= 45 ? "text-amber-400" : "text-red-400"}>{r.safetyScore}/100</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Note: DexScreener lists a token once it has an indexed pool, so brand-new mints appear within
        seconds-to-minutes (instantly in the live feed).
      </p>
    </main>
  );
}
