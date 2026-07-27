"use client";
// Native SVG candlestick chart, fed by /api/candles (real GeckoTerminal OHLCV).
//
// Why not an iframe? The DexScreener embed cannot be styled, cannot show our
// own market-cap scaling, and gives us no hover data. This draws the same
// candles we actually run the indicators on, so what you see is what the signal
// engine sees — which is the whole point when you are auditing a bad call.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/types";
import { compactUsd, usd, usdExact } from "@/lib/format";
import { Button, SegmentedControl, cx } from "./ui";

type FrameId = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** Maps the visible label onto the GeckoTerminal timeframe + aggregate pair. */
const FRAMES: Record<FrameId, { tf: string; aggregate: number; label: string }> = {
  "1m": { tf: "minute", aggregate: 1, label: "1m" },
  "5m": { tf: "minute", aggregate: 5, label: "5m" },
  "15m": { tf: "minute", aggregate: 15, label: "15m" },
  "1h": { tf: "hour", aggregate: 1, label: "1H" },
  "4h": { tf: "hour", aggregate: 4, label: "4H" },
  "1d": { tf: "day", aggregate: 1, label: "1D" },
};

const W = 1000;
const H = 340;
const VOL_H = 60;
const PAD_R = 62;
const PAD_B = 20;

export default function PriceChart({
  address,
  priceUsd,
  marketCap,
  quoteSymbol,
}: {
  address: string;
  priceUsd: number | null;
  marketCap: number | null;
  quoteSymbol?: string | null;
}) {
  const [frame, setFrame] = useState<FrameId>("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"price" | "mcap">("price");
  const [logScale, setLogScale] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  // Timestamp of the last successful candle refresh, used for the LIVE badge.
  const [lastTick, setLastTick] = useState<number>(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // How often to re-pull candles. Roughly a quarter of the candle width, so the
  // forming candle visibly grows instead of jumping only when it closes. Capped
  // so long timeframes do not hammer the API for no visual gain.
  const POLL_MS: Record<FrameId, number> = {
    "1m": 10_000,
    "5m": 15_000,
    "15m": 20_000,
    "1h": 30_000,
    "4h": 60_000,
    "1d": 60_000,
  };

  useEffect(() => {
    let alive = true;
    // Only the FIRST load of a timeframe shows the spinner. Refreshes swap the
    // data in silently, otherwise the chart would blink every few seconds.
    let first = true;
    setLoading(true);
    setErr(null);
    const f = FRAMES[frame as FrameId];
    const url =
      `/api/candles/${address}?tf=${f.tf}&aggregate=${f.aggregate}&limit=200`;

    const load = () => {
      // `cache: "no-store"` matters: without it the browser and any CDN in front
      // of the route can serve a stale candle set forever, which is exactly what
      // makes a chart look frozen.
      fetch(url, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          const next = j.candles ?? [];
          if (j.error && !next.length) setErr(j.error);
          else if (next.length) setErr(null);
          if (next.length || first) setCandles(next);
          setLastTick(Date.now());
        })
        .catch((e) => {
          // A failed refresh must not wipe a chart that is already drawn.
          if (alive && first) setErr((e as Error).message);
        })
        .finally(() => {
          if (!alive) return;
          if (first) {
            setLoading(false);
            first = false;
          }
        });
    };

    load();
    const id = setInterval(load, POLL_MS[frame as FrameId]);

    // Browsers throttle timers in background tabs, so the chart can be stale on
    // return. Refresh immediately when the tab becomes visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, frame]);

  // Market-cap mode simply rescales price by the current mcap/price ratio, i.e.
  // circulating supply. It is exact for a fixed-supply memecoin and is labelled
  // as derived rather than presented as independently sourced history.
  const supply = useMemo(() => {
    if (mode !== "mcap") return 1;
    if (!marketCap || !priceUsd) return 1;
    return marketCap / priceUsd;
  }, [mode, marketCap, priceUsd]);

  const view = useMemo(() => {
    const data = candles.map((c) => ({
      ...c,
      open: c.open * supply,
      high: c.high * supply,
      low: c.low * supply,
      close: c.close * supply,
    }));
    if (data.length === 0) return null;

    const lows = data.map((d) => d.low).filter((v) => v > 0);
    const highs = data.map((d) => d.high);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return null;
    if (min === max) {
      min *= 0.98;
      max *= 1.02;
    }
    const pad = (max - min) * 0.08;
    min = Math.max(min - pad, min * 0.5);
    max = max + pad;

    const plotH = H - VOL_H - PAD_B;
    const useLog = logScale && min > 0;
    const toY = (v: number) => {
      const value = Math.max(v, min);
      const ratio = useLog
        ? (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
        : (value - min) / (max - min);
      return plotH - ratio * plotH;
    };

    const cw = (W - PAD_R) / data.length;
    const maxVol = Math.max(...data.map((d) => d.volume || 0), 1);

    return { data, min, max, toY, cw, plotH, maxVol };
  }, [candles, supply, logScale]);

  const fmt = (v: number) => (mode === "mcap" ? compactUsd(v) : usd(v));
  const hovered = hover != null && view ? view.data[hover] : null;

  return (
    <div className="card overflow-hidden">
      {/* ── Chart toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge p-2">
        <SegmentedControl
          options={(Object.keys(FRAMES) as FrameId[]).map((k) => ({
            value: k,
            label: FRAMES[k].label,
          }))}
          value={frame}
          onChange={setFrame}
        />
        <SegmentedControl
          options={[
            { value: "price", label: "Price" },
            { value: "mcap", label: "MCap" },
          ]}
          value={mode}
          onChange={setMode}
        />
        <Button
          size="xs"
          variant={logScale ? "primary" : "outline"}
          onClick={() => setLogScale((v) => !v)}
          title="Logarithmic price axis — useful after a large move"
        >
          log
        </Button>
        {/* LIVE badge: proves the chart is actually refreshing rather than
            showing a frozen snapshot. Dims while a refresh is in flight. */}
        <span
          className={cx(
            "flex items-center gap-1 rounded-card border px-1.5 py-0.5 text-2xs font-semibold",
            lastTick
              ? "border-up/40 text-up"
              : "border-edge text-faint",
          )}
          title={
            lastTick
              ? "Updated " + new Date(lastTick).toLocaleTimeString()
              : "Waiting for data"
          }
        >
          <span
            className={cx(
              "h-1.5 w-1.5 rounded-full",
              lastTick ? "animate-pulse bg-up" : "bg-faint",
            )}
          />
          LIVE
        </span>
        <div className="ml-auto flex items-center gap-3 text-2xs text-mute">
          {hovered ? (
            <>
              <span>O {fmt(hovered.open)}</span>
              <span>H {fmt(hovered.high)}</span>
              <span>L {fmt(hovered.low)}</span>
              <span
                className={
                  hovered.close >= hovered.open ? "text-up" : "text-down"
                }
              >
                C {fmt(hovered.close)}
              </span>
              <span>Vol {compactUsd(hovered.volume)}</span>
              <span className="text-faint">
                {new Date(hovered.time).toLocaleString()}
              </span>
            </>
          ) : (
            <span>
              {candles.length} candles · {quoteSymbol ?? "SOL"} pair · hover for OHLC
            </span>
          )}
        </div>
      </div>

      {/* ── Plot ── */}
      <div className="relative">
        {loading ? (
          <div className="skeleton m-2 h-[220px] sm:h-[320px]" />
        ) : !view ? (
          <div className="grid h-[220px] place-items-center px-4 text-center text-xs text-mute sm:h-[320px]">
            {err
              ? `No candles available: ${err}`
              : "No OHLCV history for this pair yet. Brand-new pools have no candles until they have traded for a few minutes — this is also why the signal engine holds a neutral call on them."}
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-[220px] w-full sm:h-[320px]"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const rect = svgRef.current?.getBoundingClientRect();
              if (!rect) return;
              const x = ((e.clientX - rect.left) / rect.width) * W;
              const i = Math.floor(x / view.cw);
              setHover(i >= 0 && i < view.data.length ? i : null);
            }}
          >
            {/* horizontal grid + price axis */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const value = view.min + (view.max - view.min) * (1 - f);
              const y = f * view.plotH;
              return (
                <g key={f}>
                  <line
                    x1={0}
                    x2={W - PAD_R}
                    y1={y}
                    y2={y}
                    stroke="var(--c-edge)"
                    strokeWidth={1}
                  />
                  <text
                    x={W - PAD_R + 6}
                    y={y + 3.5}
                    fontSize={10}
                    fill="var(--c-faint)"
                  >
                    {fmt(value)}
                  </text>
                </g>
              );
            })}

            {/* candles */}
            {view.data.map((d, i) => {
              const up = d.close >= d.open;
              const color = up ? "var(--c-up)" : "var(--c-down)";
              const x = i * view.cw;
              const bodyW = Math.max(view.cw * 0.62, 1);
              const yO = view.toY(d.open);
              const yC = view.toY(d.close);
              const top = Math.min(yO, yC);
              const h = Math.max(Math.abs(yC - yO), 1);
              return (
                <g key={d.time}>
                  <line
                    x1={x + view.cw / 2}
                    x2={x + view.cw / 2}
                    y1={view.toY(d.high)}
                    y2={view.toY(d.low)}
                    stroke={color}
                    strokeWidth={1}
                  />
                  <rect
                    x={x + (view.cw - bodyW) / 2}
                    y={top}
                    width={bodyW}
                    height={h}
                    fill={color}
                  />
                  {/* volume histogram */}
                  <rect
                    x={x + (view.cw - bodyW) / 2}
                    y={H - PAD_B - ((d.volume || 0) / view.maxVol) * VOL_H}
                    width={bodyW}
                    height={((d.volume || 0) / view.maxVol) * VOL_H}
                    fill={color}
                    opacity={0.35}
                  />
                </g>
              );
            })}

            {/* crosshair */}
            {hover != null && view.data[hover] ? (
              <line
                x1={hover * view.cw + view.cw / 2}
                x2={hover * view.cw + view.cw / 2}
                y1={0}
                y2={H - PAD_B}
                stroke="var(--c-edge-2)"
                strokeDasharray="3 3"
              />
            ) : null}
          </svg>
        )}
      </div>

      {mode === "mcap" && (!marketCap || !priceUsd) ? (
        <p className="border-t border-edge px-3 py-1.5 text-2xs text-warn">
          Market cap is unknown for this pair, so the chart is still showing
          price.
        </p>
      ) : null}
      {priceUsd ? (
        <p className="border-t border-edge px-3 py-1.5 text-2xs text-faint">
          Exact price: <span className="font-mono">{usdExact(priceUsd)}</span>
          {mode === "mcap"
            ? " · MCap view = price × circulating supply derived from the current market cap."
            : ""}
        </p>
      ) : null}
    </div>
  );
}
