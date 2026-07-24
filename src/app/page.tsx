"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type { TokenSummary } from "@/lib/types";
import { usd, compact, pct, pctColor, ageLabel } from "@/lib/format";
import WelcomePanel from "@/components/WelcomePanel";

type Sort = "trending" | "volume" | "gainers" | "new" | "searched";

const TABS: { id: Sort; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "volume", label: "Volume" },
  { id: "gainers", label: "Gainers" },
  { id: "new", label: "New" },
  { id: "searched", label: "Searched" },
];

export default function ScannerPage() {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [sort, setSort] = useState<Sort>("trending");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Client-side filters (Photon/DexScreener style).
  const [minLiq, setMinLiq] = useState<string>("");
  const [minMcap, setMinMcap] = useState<string>("");
  const [minVol, setMinVol] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      else params.set("sort", sort);
      const r = await fetch(`/api/tokens?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to load");
      setTokens(j.tokens ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, sort]);

  useEffect(() => {
    load();
  }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 30s (real live data).
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const visible = useMemo(() => {
    const liq = Number(minLiq) || 0;
    const mc = Number(minMcap) || 0;
    const vol = Number(minVol) || 0;
    return tokens.filter(
      (t) =>
        (t.liquidityUsd ?? 0) >= liq &&
        ((t.marketCap ?? t.fdv) ?? 0) >= mc &&
        (t.volume24h ?? 0) >= vol,
    );
  }, [tokens, minLiq, minMcap, minVol]);

  const hasFilters = minLiq !== "" || minMcap !== "" || minVol !== "";

  return (
    <div className="space-y-4">
      <WelcomePanel />

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-300/90">
        Live Solana data (DexScreener + on-chain). This tool surfaces momentum and
        risk signals — it does <b>not</b> predict the future. Memecoins are extremely
        high risk; most go to zero. Never invest more than you can lose.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className="flex-1 min-w-[220px]"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search token name / symbol / address..."
            className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500/50"
          />
        </form>
        <div className="flex gap-1 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setQ("");
                setSort(t.id);
              }}
              className={
                "px-3 py-2 rounded-lg text-sm " +
                (sort === t.id && !q
                  ? "bg-indigo-600 text-white"
                  : "bg-panel border border-edge text-slate-300 hover:text-white")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          className="px-3 py-2 rounded-lg text-sm bg-panel border border-edge text-slate-300 hover:text-white"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="uppercase tracking-wide text-slate-500">Filters</span>
        <input
          value={minLiq}
          onChange={(e) => setMinLiq(e.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          placeholder="Min liquidity $"
          className="w-36 bg-panel border border-edge rounded-md px-2 py-1.5"
        />
        <input
          value={minMcap}
          onChange={(e) => setMinMcap(e.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          placeholder="Min market cap $"
          className="w-36 bg-panel border border-edge rounded-md px-2 py-1.5"
        />
        <input
          value={minVol}
          onChange={(e) => setMinVol(e.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          placeholder="Min 24h volume $"
          className="w-36 bg-panel border border-edge rounded-md px-2 py-1.5"
        />
        {hasFilters && (
          <button
            onClick={() => {
              setMinLiq("");
              setMinMcap("");
              setMinVol("");
            }}
            className="rounded-md border border-edge px-2 py-1.5 hover:text-white"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-slate-500">{visible.length} tokens</span>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
          {err}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full text-sm">
          <thead className="bg-panel text-slate-400 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Token</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">1h</th>
              <th className="text-right px-3 py-2">24h</th>
              <th className="text-right px-3 py-2">MCap</th>
              <th className="text-right px-3 py-2">Liq</th>
              <th className="text-right px-3 py-2">Vol 24h</th>
              <th className="text-right px-3 py-2">Age</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.address} className="border-t border-edge hover:bg-white/5">
                <td className="px-3 py-2">
                  <Link href={`/token/${t.address}`} className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {t.imageUrl ? (
                      <img src={t.imageUrl} alt="" className="w-6 h-6 rounded-full bg-edge object-cover" />
                    ) : (
                      <span className="flex w-6 h-6 items-center justify-center rounded-full bg-edge text-[9px] font-bold text-slate-300">
                        {(t.symbol || "?").slice(0, 3).toUpperCase()}
                      </span>
                    )}
                    <span className="font-semibold text-white">{t.symbol}</span>
                    <span className="text-slate-500 truncate max-w-[140px]">{t.name}</span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono">{usd(t.priceUsd)}</td>
                <td className={`px-3 py-2 text-right ${pctColor(t.priceChange1h)}`}>{pct(t.priceChange1h)}</td>
                <td className={`px-3 py-2 text-right ${pctColor(t.priceChange24h)}`}>{pct(t.priceChange24h)}</td>
                <td className="px-3 py-2 text-right">{compact(t.marketCap ?? t.fdv)}</td>
                <td className="px-3 py-2 text-right">{compact(t.liquidityUsd)}</td>
                <td className="px-3 py-2 text-right">{compact(t.volume24h)}</td>
                <td className="px-3 py-2 text-right text-slate-400">{ageLabel(t.ageHours)}</td>
              </tr>
            ))}
            {visible.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  {sort === "searched"
                    ? "No searches yet. Search a token and it will show up here."
                    : "No tokens found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
