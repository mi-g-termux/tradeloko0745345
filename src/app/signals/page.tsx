"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { shortAddr } from "@/lib/format";

interface SignalRow {
  id: string;
  token_address: string;
  symbol: string | null;
  direction: string | null;
  confidence: number | null;
  score: number | null;
  alerted: boolean;
  created_at: string;
}

function dirPill(d: string | null) {
  const base = "px-2 py-0.5 rounded text-xs font-semibold ";
  if (d === "bullish") return base + "bg-emerald-500/10 text-emerald-400";
  if (d === "bearish") return base + "bg-red-500/10 text-red-400";
  return base + "bg-slate-500/10 text-slate-300";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function SignalsPage() {
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");

  async function load() {
    setLoading(true);
    const qs = filter ? `?direction=${filter}` : "";
    const r = await fetch(`/api/signals${qs}`);
    const j = await r.json();
    setRows(j.signals ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-white">Signal history</h1>
          <p className="text-xs text-slate-500">
            Past calls from the auto-scanner and manual alerts. A signal is a
            probability, not a guarantee — review how they aged.
          </p>
        </div>
        <div className="flex gap-1">
          {[
            { v: "", l: "All" },
            { v: "bullish", l: "Bullish" },
            { v: "bearish", l: "Bearish" },
          ].map((f) => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className={
                "px-3 py-1.5 rounded-md text-sm " +
                (filter === f.v
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white hover:bg-white/5")
              }
            >
              {f.l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-edge bg-panel p-6 text-center text-slate-500">
          No signals recorded yet. Turn on the auto-scanner in Admin, or hit
          “Send to Telegram” on a token, and calls will appear here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-edge">
          <table className="w-full text-sm">
            <thead className="bg-panel text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Token</th>
                <th className="text-left px-3 py-2">Direction</th>
                <th className="text-right px-3 py-2">Confidence</th>
                <th className="text-right px-3 py-2">Score</th>
                <th className="text-center px-3 py-2">Alerted</th>
                <th className="text-right px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-edge hover:bg-white/5">
                  <td className="px-3 py-2">
                    <Link href={`/token/${r.token_address}`} className="text-indigo-400 hover:text-indigo-300">
                      {r.symbol || shortAddr(r.token_address)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={dirPill(r.direction)}>{r.direction}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-200">{r.confidence ?? "—"}%</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">{r.score ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-center">
                      {r.alerted ? (
                        <Check size={15} className="text-emerald-400" />
                      ) : (
                        <Minus size={15} className="text-slate-600" />
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
