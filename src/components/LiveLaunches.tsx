"use client";
// Photon-style LIVE new-token feed with filters. Streams every new pump.fun mint
// the instant it is created via the free PumpPortal websocket (no polling, no API
// key), enriches each row with its logo (from the token metadata URI), and shows
// market cap + initial dev buy + a live age counter. Client-side filters let you
// narrow by search / minimum market cap / minimum dev buy.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Rocket, Zap, Search } from "lucide-react";

interface LiveToken {
  mint: string;
  symbol: string;
  name: string;
  uri?: string;
  logo?: string | null;
  marketCapSol?: number | null;
  initialBuySol?: number | null;
  at: number;
}

type Status = "connecting" | "live" | "closed";

// Turn an ipfs:// or gateway URL into a browser-loadable https URL.
function resolveUri(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    return "https://ipfs.io/ipfs/" + uri.slice("ipfs://".length);
  }
  return uri;
}

function ageStr(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h";
}

function fmtSol(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(3);
}

function fmtUsd(sol: number | null | undefined, solPrice: number | null): string {
  if (sol == null) return "—";
  if (solPrice == null) return fmtSol(sol) + " SOL";
  const v = sol * solPrice;
  if (v >= 1000) return "$" + (v / 1000).toFixed(1) + "K";
  return "$" + v.toFixed(0);
}

const MCAP_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: "Any", value: null },
  { label: "$5K+", value: 5000 },
  { label: "$10K+", value: 10000 },
  { label: "$25K+", value: 25000 },
];
const DEVBUY_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: "Any", value: null },
  { label: "0.5+", value: 0.5 },
  { label: "1+", value: 1 },
  { label: "5+", value: 5 },
];

export default function LiveLaunches() {
  const [items, setItems] = useState<LiveToken[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [minMcap, setMinMcap] = useState<number | null>(null);
  const [minDevBuy, setMinDevBuy] = useState<number | null>(null);
  const pausedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Best-effort SOL price for USD market caps (falls back to SOL values).
  useEffect(() => {
    let dead = false;
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
      .then((r) => r.json())
      .then((d: { solana?: { usd?: number } }) => {
        if (!dead && d?.solana?.usd) setSolPrice(d.solana.usd);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, []);

  // Tick the clock so the age column counts up live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch a token's logo from its metadata URI, then patch it into the row.
  function hydrateLogo(mint: string, uri?: string) {
    if (!uri) return;
    fetch(resolveUri(uri))
      .then((r) => r.json())
      .then((meta: { image?: string }) => {
        const img = meta?.image ? resolveUri(meta.image) : null;
        if (!img) return;
        setItems((prev) =>
          prev.map((it) => (it.mint === mint ? { ...it, logo: img } : it)),
        );
      })
      .catch(() => {});
  }

  useEffect(() => {
    let closed = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket("wss://pumpportal.fun/api/data");
    } catch {
      setStatus("closed");
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus("live");
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    };
    ws.onmessage = (ev) => {
      if (pausedRef.current) return;
      try {
        const d = JSON.parse(ev.data as string) as {
          mint?: string;
          ca?: string;
          token?: string;
          symbol?: string;
          name?: string;
          uri?: string;
          marketCapSol?: number;
          solAmount?: number;
        };
        const mint = d.mint ?? d.ca ?? d.token;
        if (!mint) return;
        const token: LiveToken = {
          mint,
          symbol: d.symbol ?? "?",
          name: d.name ?? "",
          uri: d.uri,
          logo: null,
          marketCapSol: d.marketCapSol ?? null,
          initialBuySol: d.solAmount ?? null,
          at: Date.now(),
        };
        setItems((prev) => [token, ...prev].slice(0, 60));
        hydrateLogo(mint, d.uri);
      } catch {
        /* ignore heartbeats / non-JSON frames */
      }
    };
    ws.onclose = () => {
      if (!closed) setStatus("closed");
    };
    ws.onerror = () => setStatus("closed");
    return () => {
      closed = true;
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  function togglePause() {
    const next = !paused;
    setPaused(next);
    pausedRef.current = next;
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (q) {
        const hay = (it.symbol + " " + it.name + " " + it.mint).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (minDevBuy != null && (it.initialBuySol ?? 0) < minDevBuy) return false;
      if (minMcap != null && solPrice != null) {
        const mc = (it.marketCapSol ?? 0) * solPrice;
        if (mc < minMcap) return false;
      }
      return true;
    });
  }, [items, query, minDevBuy, minMcap, solPrice]);

  const dot =
    status === "live"
      ? "bg-emerald-400"
      : status === "connecting"
        ? "bg-amber-400"
        : "bg-red-400";

  return (
    <div className="rounded-xl border border-edge bg-panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <Rocket className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-semibold text-white">New pairs — live</span>
        <span className={"ml-1 h-2 w-2 rounded-full " + dot} />
        <span className="text-xs text-slate-500">
          {status === "live"
            ? paused
              ? "paused"
              : "streaming new mints in real time"
            : status === "connecting"
              ? "connecting…"
              : "disconnected — reload to reconnect"}
        </span>
        <button
          onClick={togglePause}
          className="ml-auto rounded-md border border-edge px-2 py-1 text-xs text-slate-300 hover:text-white"
        >
          {paused ? "Resume" : "Pause"}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-[#0b0d12] px-4 py-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol / name / mint…"
            className="w-full rounded-md border border-edge bg-panel py-1.5 pl-7 pr-2 text-xs text-white focus:border-indigo-500/50 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-500">Mkt cap</span>
          {MCAP_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setMinMcap(p.value)}
              className={
                "rounded-md px-2 py-1 text-[11px] " +
                (minMcap === p.value
                  ? "bg-indigo-600 text-white"
                  : "border border-edge text-slate-300 hover:text-white")
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-500">Dev buy</span>
          {DEVBUY_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setMinDevBuy(p.value)}
              className={
                "rounded-md px-2 py-1 text-[11px] " +
                (minDevBuy === p.value
                  ? "bg-indigo-600 text-white"
                  : "border border-edge text-slate-300 hover:text-white")
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#0b0d12] text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Pair</th>
              <th className="px-3 py-2 text-right">Age</th>
              <th className="px-3 py-2 text-right">Mkt cap</th>
              <th className="px-3 py-2 text-right">Dev buy</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {status !== "live"
                    ? "Connecting to the live feed…"
                    : items.length === 0
                      ? "Waiting for the next mint… new pump.fun tokens appear here the instant they launch."
                      : "No tokens match your filters."}
                </td>
              </tr>
            )}
            {filtered.map((it) => (
              <tr key={it.mint} className="border-t border-edge hover:bg-white/5">
                <td className="px-4 py-2">
                  <Link href={"/token/" + it.mint} className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {it.logo ? (
                      <img
                        src={it.logo}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded-full bg-edge object-cover"
                      />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-edge text-[10px] font-bold text-slate-300">
                        {(it.symbol || "?").slice(0, 3).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-white">
                        ${it.symbol}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {it.name}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono text-emerald-400">
                  {ageStr(it.at, now)}
                </td>
                <td className="px-3 py-2 text-right text-slate-200">
                  {fmtUsd(it.marketCapSol, solPrice)}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {it.initialBuySol != null ? fmtSol(it.initialBuySol) + " SOL" : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={"/token/" + it.mint}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                  >
                    <Zap className="h-3 w-3" /> Trade
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
