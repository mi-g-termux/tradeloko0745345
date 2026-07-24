"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import type { TokenSummary, SafetyReport } from "@/lib/types";
import { usd, compact, pct, pctColor, ageLabel, shortAddr } from "@/lib/format";
import { BuyPanel } from "@/components/BuyPanel";
import { SignalPanel } from "@/components/SignalPanel";
import { TopHolders } from "@/components/TopHolders";

export default function TokenPage() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const [summary, setSummary] = useState<TokenSummary | null>(null);
  const [safety, setSafety] = useState<SafetyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [safetyLoading, setSafetyLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/token/${address}`);
      const j = await r.json();
      setSummary(j.summary ?? null);
      setLoading(false);
    })();
    (async () => {
      const r = await fetch(`/api/safety/${address}`);
      const j = await r.json();
      setSafety(j.report ?? null);
      setSafetyLoading(false);
    })();
  }, [address]);

  const verdictColor =
    safety?.verdict === "ok"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
      : safety?.verdict === "caution"
        ? "text-amber-400 border-amber-500/30 bg-amber-500/5"
        : "text-red-400 border-red-500/30 bg-red-500/5";

  return (
    <div className="space-y-5">
      {loading ? (
        <div className="text-slate-500">Loading token…</div>
      ) : !summary ? (
        <div className="rounded-lg border border-edge bg-panel p-5 space-y-3">
          <div className="text-white font-bold">Brand-new token</div>
          <p className="text-sm text-slate-400">
            This token is not on DexScreener yet. Freshly-launched pump.fun
            tokens take a few minutes to be indexed by DEX aggregators, and they
            trade on the pump.fun bonding curve until they graduate to a DEX.
            In-app (Jupiter) buys work after graduation; until then, trade it on
            pump.fun.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://pump.fun/${address}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Trade on Pump.fun <ExternalLink size={14} />
            </a>
            <a
              href={`https://dexscreener.com/solana/${address}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-slate-200 hover:text-white"
            >
              DexScreener <ExternalLink size={14} />
            </a>
            <a
              href={`https://solscan.io/token/${address}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-slate-200 hover:text-white"
            >
              Solscan <ExternalLink size={14} />
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(address)}
              className="inline-flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-slate-200 hover:text-white"
            >
              Copy CA
            </button>
            <button
              onClick={() => location.reload()}
              className="inline-flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-slate-200 hover:text-white"
            >
              Retry
            </button>
          </div>
          <div className="text-xs text-slate-500 font-mono break-all">{address}</div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {summary.imageUrl ? (
              <img src={summary.imageUrl} alt="" className="w-10 h-10 rounded-full" />
            ) : (
              <span className="w-10 h-10 rounded-full bg-edge inline-block" />
            )}
            <div>
              <div className="text-xl font-bold text-white">
                {summary.symbol}{" "}
                <span className="text-slate-500 text-base font-normal">{summary.name}</span>
              </div>
              <div className="text-xs text-slate-500 font-mono">{shortAddr(summary.address)}</div>
            </div>
            {summary.url && (
              <a
                href={summary.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300"
              >
                Chart on DexScreener <ExternalLink size={14} />
              </a>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Price" value={usd(summary.priceUsd)} />
            <Stat label="24h" value={pct(summary.priceChange24h)} cls={pctColor(summary.priceChange24h)} />
            <Stat label="Liquidity" value={"$" + compact(summary.liquidityUsd)} />
            <Stat label="Volume 24h" value={"$" + compact(summary.volume24h)} />
            <Stat label="Market Cap" value={"$" + compact(summary.marketCap ?? summary.fdv)} />
            <Stat label="Age" value={ageLabel(summary.ageHours)} />
            <Stat label="Buys 24h" value={compact(summary.txns24hBuys)} />
            <Stat label="Sells 24h" value={compact(summary.txns24hSells)} />
          </div>

          {summary.url && (
            <iframe
              title="chart"
              src={`https://dexscreener.com/solana/${summary.address}?embed=1&theme=dark&info=0`}
              className="w-full h-[420px] rounded-lg border border-edge"
            />
          )}

          {/* Analysis engine: technicals + patterns + AI + buy-point signal */}
          <SignalPanel address={summary.address} />

          <div className={`rounded-lg border p-4 ${verdictColor}`}>
            <div className="flex items-center justify-between">
              <div className="font-bold uppercase tracking-wide text-sm">
                Safety: {safetyLoading ? "analyzing…" : `${safety?.score ?? 0}/100 · ${safety?.verdict}`}
              </div>
            </div>
            {safety && (
              <ul className="mt-3 space-y-1.5 text-sm">
                {safety.factors.map((f) => (
                  <li key={f.key} className="flex items-start gap-2">
                    {f.ok ? (
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
                    )}
                    <span className="text-slate-300">
                      <b>{f.label}.</b> <span className="text-slate-400">{f.detail}</span>
                    </span>
                  </li>
                ))}
                {safety.notes.map((n, i) => (
                  <li key={"n" + i} className="text-slate-500 text-xs pl-6">{n}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Safety score = fewer obvious rug signals. It is NOT a prediction that price will rise.
            </p>
          </div>

          {/* Biggest holders + per-wallet profit estimate */}
          <TopHolders address={summary.address} />

          <BuyPanel address={summary.address} symbol={summary.symbol} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 font-mono ${cls ?? "text-white"}`}>{value}</div>
    </div>
  );
}
