"use client";
import { useEffect, useState } from "react";
import { Users, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { usd, compact, shortAddr } from "@/lib/format";

interface Holder {
  owner: string;
  tokenAccount: string;
  amount: number;
  pctSupply: number;
  valueUsd: number | null;
}

interface HoldersResponse {
  supply: number;
  holderCount: number;
  holders: Holder[];
  priceUsd: number | null;
  needsKey?: boolean;
}

interface Pnl {
  netSol: number;
  realizedSol: number;
  investedSol: number;
  currentValueSol: number;
  swaps: number;
  partial: boolean;
  needsKey?: boolean;
}

export function TopHolders({ address }: { address: string }) {
  const [data, setData] = useState<HoldersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pnl, setPnl] = useState<Record<string, Pnl | "loading" | "error">>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/holders/${address}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Failed to load holders");
        // The API answers { result: { supply, holderCount, holders }, priceUsd }.
        // This used to do setData(j), so data.holders was undefined and reading
        // .length crashed the whole tab. Unwrap the envelope explicitly.
        if (j.error) throw new Error(j.error);
        if (!j.result) {
          setData(null);
          setErr(j.reason ?? "Holder data is unavailable for this token.");
          return;
        }
        setData({ ...j.result, priceUsd: j.priceUsd ?? null });
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [address]);

  async function loadPnl(h: Holder) {
    setPnl((p) => ({ ...p, [h.owner]: "loading" }));
    try {
      const r = await fetch(`/api/holders/${address}/pnl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: h.owner, amount: h.amount }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      setPnl((p) => ({ ...p, [h.owner]: j }));
    } catch {
      setPnl((p) => ({ ...p, [h.owner]: "error" }));
    }
  }

  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="flex items-center gap-2 mb-1">
        <Users size={16} className="text-indigo-400" />
        <span className="font-bold text-white">Top holders</span>
        {data && (
          <span className="text-xs text-slate-500">
            {data.holderCount} tracked · largest wallets
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
          <Loader2 size={15} className="animate-spin" /> Loading holders…
        </div>
      ) : err ? (
        <div className="text-red-400 text-sm py-2">{err}</div>
      ) : !data || !data.holders || data.holders.length === 0 ? (
        <div className="text-slate-500 text-sm py-2">No holder data available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left py-1.5 pr-2">#</th>
                <th className="text-left py-1.5 pr-2">Wallet</th>
                <th className="text-right py-1.5 px-2">Tokens</th>
                <th className="text-right py-1.5 px-2">% supply</th>
                <th className="text-right py-1.5 px-2">Value</th>
                <th className="text-right py-1.5 pl-2">Est. PnL</th>
              </tr>
            </thead>
            <tbody>
              {(data.holders ?? []).map((h, i) => {
                const p = pnl[h.owner];
                const big = h.pctSupply >= 5;
                return (
                  <tr key={h.tokenAccount} className="border-t border-edge">
                    <td className="py-1.5 pr-2 text-slate-500">{i + 1}</td>
                    <td className="py-1.5 pr-2">
                      <a
                        href={`https://solscan.io/account/${h.owner}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-indigo-400 hover:text-indigo-300"
                      >
                        {shortAddr(h.owner)}
                      </a>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-slate-300">{compact(h.amount)}</td>
                    <td className={`py-1.5 px-2 text-right font-mono ${big ? "text-amber-400" : "text-slate-300"}`}>
                      {h.pctSupply.toFixed(2)}%
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                      {h.valueUsd != null ? usd(h.valueUsd) : "—"}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {p === "loading" ? (
                        <Loader2 size={13} className="animate-spin inline text-slate-400" />
                      ) : p === "error" ? (
                        <span className="text-xs text-red-400">failed</span>
                      ) : p && typeof p === "object" ? (
                        p.needsKey ? (
                          <span className="text-xs text-slate-500">needs key</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 font-mono ${p.netSol >= 0 ? "text-emerald-400" : "text-red-400"}`}
                            title={`Realized ${p.realizedSol.toFixed(2)} + holding ${p.currentValueSol.toFixed(2)} − invested ${p.investedSol.toFixed(2)} SOL${p.partial ? " (partial history)" : ""}`}
                          >
                            {p.netSol >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                            {p.netSol >= 0 ? "+" : ""}{p.netSol.toFixed(2)} SOL{p.partial ? "*" : ""}
                          </span>
                        )
                      ) : (
                        <button
                          onClick={() => loadPnl(h)}
                          className="text-xs px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-slate-200"
                        >
                          PnL
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data?.needsKey && (
        <p className="mt-2 text-xs text-amber-300/80">
          Add a Helius API key in Admin for richer holder data and per-wallet PnL.
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        PnL is a best-effort estimate (realized + current holding − invested, in SOL)
        from a wallet’s recent swaps for this token. It ignores fees and complex
        routing, and can be partial (*) for very active wallets. Not financial advice.
      </p>
    </div>
  );
}
