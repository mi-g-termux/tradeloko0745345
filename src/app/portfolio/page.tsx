"use client";
// /portfolio — live wallet holdings + PnL (feature #4). Enter any wallet, or if
// signed in with a wallet it loads yours automatically.
import { useState } from "react";

interface Holding {
  tokenAddress: string;
  symbol: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  costSol: number | null;
}
interface Portfolio {
  wallet: string;
  solBalance: number;
  holdings: Holding[];
  totalValueUsd: number;
}

function usd(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function PortfolioPage() {
  const [wallet, setWallet] = useState("");
  const [data, setData] = useState<Portfolio | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const q = wallet.trim() ? `?wallet=${encodeURIComponent(wallet.trim())}` : "";
      const d = await fetch(`/api/portfolio${q}`).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setData(d.portfolio);
    } catch (e) {
      setErr((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Portfolio &amp; PnL</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Real on-chain balances priced live. Cost basis is shown where we have a
        record of your buys.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="Solana wallet address (or leave blank if signed in)"
          className="flex-1 rounded-lg border border-[#1a1f2e] bg-[#0f1117] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
        />
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

      {data && (
        <div className="mt-6">
          <div className="flex flex-wrap gap-4">
            <div className="rounded-xl border border-[#1a1f2e] bg-[#0f1117] px-4 py-3">
              <div className="text-xs text-zinc-500">SOL balance</div>
              <div className="text-lg font-semibold text-zinc-100">{data.solBalance.toFixed(4)} SOL</div>
            </div>
            <div className="rounded-xl border border-[#1a1f2e] bg-[#0f1117] px-4 py-3">
              <div className="text-xs text-zinc-500">Token value</div>
              <div className="text-lg font-semibold text-zinc-100">{usd(data.totalValueUsd)}</div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-[#1a1f2e]">
            <table className="w-full text-sm">
              <thead className="bg-[#0f1117] text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Token</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Cost (SOL)</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">No token holdings above $1.</td></tr>
                )}
                {data.holdings.map((h) => (
                  <tr key={h.tokenAddress} className="border-t border-[#1a1f2e]">
                    <td className="px-3 py-2">
                      <a href={`/token/${h.tokenAddress}`} className="text-zinc-100 hover:underline">{h.symbol}</a>
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{h.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="px-3 py-2 text-zinc-400">{h.priceUsd == null ? "—" : `$${h.priceUsd.toPrecision(4)}`}</td>
                    <td className="px-3 py-2 text-zinc-200">{usd(h.valueUsd)}</td>
                    <td className="px-3 py-2 text-zinc-500">{h.costSol == null ? "—" : `${h.costSol.toFixed(3)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
