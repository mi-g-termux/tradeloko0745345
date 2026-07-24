"use client";
// Live pump.fun creation feed via the free PumpPortal websocket (feature #1).
import { useEffect, useRef, useState } from "react";

interface LiveToken { mint: string; symbol: string; name: string; at: number; }

export default function LiveLaunches() {
  const [items, setItems] = useState<LiveToken[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "closed">("connecting");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket;
    try { ws = new WebSocket("wss://pumpportal.fun/api/data"); }
    catch { setStatus("closed"); return; }
    wsRef.current = ws;
    ws.onopen = () => { setStatus("live"); ws.send(JSON.stringify({ method: "subscribeNewToken" })); };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        const mint = d.mint ?? d.ca ?? d.token;
        if (!mint) return;
        setItems((prev) => [{ mint, symbol: d.symbol ?? "?", name: d.name ?? "", at: Date.now() }, ...prev].slice(0, 15));
      } catch { /* ignore heartbeat */ }
    };
    ws.onclose = () => !closed && setStatus("closed");
    ws.onerror = () => setStatus("closed");
    return () => { closed = true; try { ws.close(); } catch { /* noop */ } };
  }, []);

  return (
    <div className="mt-4 rounded-xl border border-[#1a1f2e] bg-[#0f1117] p-4">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${status === "live" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-red-400"}`} />
        <span className="text-sm font-medium text-zinc-200">Live pump.fun feed</span>
        <span className="text-xs text-zinc-500">{status === "live" ? "streaming new mints" : status === "connecting" ? "connecting…" : "disconnected"}</span>
      </div>
      <ul className="mt-3 space-y-1">
        {items.length === 0 && <li className="text-xs text-zinc-500">Waiting for the next mint…</li>}
        {items.map((it) => (
          <li key={it.mint} className="flex items-center justify-between gap-2 text-sm">
            <a href={`/token/${it.mint}`} className="truncate text-zinc-200 hover:underline">
              <span className="font-medium">{it.symbol}</span>{" "}<span className="text-zinc-500">{it.name}</span>
            </a>
            <span className="shrink-0 font-mono text-[11px] text-zinc-600">{it.mint.slice(0, 4)}…{it.mint.slice(-4)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
