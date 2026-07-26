"use client";
import { useEffect, useState } from "react";
import { Heart, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { TradeSignal } from "@/lib/types";

function dirColor(d: string) {
  return d === "bullish"
    ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
    : d === "bearish"
      ? "text-red-400 border-red-500/30 bg-red-500/5"
      : "text-slate-300 border-slate-500/30 bg-slate-500/5";
}

function mc(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return "$" + (n / 1000).toFixed(0) + "K";
  return "$" + n.toFixed(0);
}

function priceStr(n: number | null): string {
  if (n == null) return "—";
  return n < 1 ? "$" + n.toPrecision(4) : "$" + n.toFixed(2);
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-edge bg-base px-2 py-1 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-200">{value}</span>
    </span>
  );
}

export function SignalPanel({ address }: { address: string }) {
  const [sig, setSig] = useState<TradeSignal | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/analysis/${address}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Analysis failed");
      setSig(j.signal);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setIsAdmin(Boolean(j.user?.isAdmin)))
      .catch(() => {});
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendToTelegram() {
    setSending(true);
    setSendMsg(null);
    try {
      const r = await fetch(`/api/analysis/${address}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      setSendMsg(
        j.sent
          ? { kind: "ok", text: "Alert sent to Telegram." }
          : { kind: "warn", text: "Telegram alerts are off or not configured." },
      );
    } catch (e) {
      setSendMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="text-slate-500">Running analysis engine…</div>;
  if (err) return <div className="text-red-400 text-sm">{err}</div>;
  if (!sig) return null;

  const ind = sig.indicators;
  const social = sig.social;

  return (
    <div className={`rounded-lg border p-4 ${dirColor(sig.direction)}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="font-bold uppercase tracking-wide">
          Signal: {sig.direction} · {sig.confidence}% confidence
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="text-xs text-slate-400 hover:text-white">
            Refresh
          </button>
          {isAdmin && (
            <button
              onClick={sendToTelegram}
              disabled={sending}
              className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-50"
            >
              {sending ? "…" : "Send to Telegram"}
            </button>
          )}
        </div>
      </div>
      {/* Evidence quality — the fix for "the signal is not accurate". The engine
          now states how much real price history it had, and openly holds a
          neutral call when there is not enough. */}
      {sig.quality && (
        <div className="mt-2 rounded-md border border-white/10 bg-black/20 p-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-300">
              Evidence:{" "}
              {sig.quality.level === "high"
                ? "strong"
                : sig.quality.level === "medium"
                  ? "usable"
                  : sig.quality.level === "low"
                    ? "thin"
                    : "none"}
            </span>
            <span className="text-slate-400">
              {sig.quality.candles} candles · {sig.quality.timeframe} timeframe
            </span>
          </div>
          {sig.quality.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {sig.quality.notes.map((n, i) => (
                <li key={i} className="text-[11px] text-amber-300/80">
                  {n}
                </li>
              ))}
            </ul>
          )}
          {sig.factors && sig.factors.length > 0 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
                Why this score? ({sig.factors.length} factors)
              </summary>
              <ul className="mt-1 space-y-0.5">
                {sig.factors.map((f, i) => (
                  <li key={i} className="text-[11px] text-slate-400">
                    <span
                      className={
                        f.score > 0
                          ? "text-emerald-400"
                          : f.score < 0
                            ? "text-red-400"
                            : "text-slate-500"
                      }
                    >
                      {f.score > 0 ? "+" : ""}
                      {f.score}
                    </span>{" "}
                    <b>{f.label}</b> · weight {f.weight} — {f.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {sendMsg && (
        <div
          className={
            "mt-1 flex items-center gap-1.5 text-xs " +
            (sendMsg.kind === "ok"
              ? "text-emerald-400"
              : sendMsg.kind === "warn"
                ? "text-amber-400"
                : "text-red-400")
          }
        >
          {sendMsg.kind === "ok" ? (
            <CheckCircle2 size={13} />
          ) : sendMsg.kind === "warn" ? (
            <AlertTriangle size={13} />
          ) : (
            <XCircle size={13} />
          )}
          {sendMsg.text}
        </div>
      )}

      {/* confidence bar */}
      <div className="mt-2 h-2 w-full rounded-full bg-base overflow-hidden">
        <div
          className={
            "h-full " +
            (sig.direction === "bullish"
              ? "bg-emerald-500"
              : sig.direction === "bearish"
                ? "bg-red-500"
                : "bg-slate-500")
          }
          style={{ width: `${sig.confidence}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge label="trend" value={ind.trend} />
        <Badge label="RSI" value={ind.rsi14 != null ? ind.rsi14.toFixed(0) : "—"} />
        <Badge label="MACD" value={ind.macdHist != null ? ind.macdHist.toExponential(1) : "—"} />
        <Badge label="support" value={ind.support != null ? ind.support.toPrecision(4) : "—"} />
        <Badge label="resist" value={ind.resistance != null ? ind.resistance.toPrecision(4) : "—"} />
        {sig.priceUsd != null && <Badge label="price" value={priceStr(sig.priceUsd)} />}
        {sig.marketCap != null && <Badge label="mkt cap" value={mc(sig.marketCap)} />}
        {sig.safetyScore != null && <Badge label="safety" value={`${sig.safetyScore}/100`} />}
        {social?.available && <Badge label="X mentions" value={String(social.mentionCount)} />}
      </div>

      {sig.patterns.length > 0 && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Chart patterns</div>
          <ul className="space-y-1 text-sm">
            {sig.patterns.map((p) => (
              <li key={p.name} className="text-slate-300">
                <b>{p.name}</b>{" "}
                <span className={p.direction === "bullish" ? "text-emerald-400" : p.direction === "bearish" ? "text-red-400" : "text-slate-400"}>
                  ({p.direction})
                </span>{" "}
                <span className="text-slate-500">{p.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(sig.suggestedEntry || (sig.targets && sig.targets.length > 0) || sig.stopLoss) && (
        <div className="mt-3 rounded-md border border-edge bg-base p-3 space-y-1 text-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Trade plan</div>
          {sig.suggestedEntry && (
            <p className="text-slate-200">
              <b className="text-emerald-400">Buy:</b> {sig.suggestedEntry}
            </p>
          )}
          {sig.targets && sig.targets.length > 0 && (
            <p className="text-slate-200">
              <b className="text-indigo-300">Targets:</b> {sig.targets.join(", ")}
            </p>
          )}
          {sig.stopLoss && (
            <p className="text-slate-300">
              <b className="text-red-400">Stop:</b> {sig.stopLoss}
            </p>
          )}
          {sig.invalidation && (
            <p className="text-slate-400 text-xs">{sig.invalidation}</p>
          )}
        </div>
      )}

      {/* X / Twitter social */}
      {social?.available ? (
        <div className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/5 p-3">
          <div className="text-xs uppercase tracking-wide text-sky-300 mb-1">
            X / Twitter — {social.mentionCount} recent mentions · sentiment{" "}
            <span className={social.sentiment >= 0 ? "text-emerald-400" : "text-red-400"}>
              {social.sentiment.toFixed(2)}
            </span>
          </div>
          <ul className="space-y-1 text-xs text-slate-300">
            {social.topTweets.map((t, i) => (
              <li key={i} className="truncate">
                <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">
                  <Heart size={11} className="text-pink-400" /> {t.likes} · {t.text}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : social?.needsKey ? (
        <p className="mt-3 text-xs text-slate-500">
          X feed is on but no bearer token is set. Add it in Admin to fold social buzz into the signal.
        </p>
      ) : null}

      {sig.ai ? (
        <div className="mt-3 rounded-md border border-indigo-500/20 bg-indigo-500/5 p-3">
          <div className="text-xs uppercase tracking-wide text-indigo-300 mb-1">
            AI lean ({sig.ai.model}) — {sig.ai.lean} {sig.ai.confidence}%
          </div>
          <p className="text-sm text-slate-300">{sig.ai.reasoning}</p>
          {sig.ai.targets.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">Targets: {sig.ai.targets.join(", ")}</p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          AI analysis is off. An admin can enable Gemini in the Admin panel to add an AI lean.
        </p>
      )}

      <details className="mt-3">
        <summary className="text-xs text-slate-500 cursor-pointer">Why this signal?</summary>
        <ul className="mt-2 space-y-1 text-xs text-slate-400 list-disc pl-5">
          {sig.rationale.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </details>

      <p className="mt-3 text-[11px] text-slate-500">
        This is a probabilistic signal from momentum, technicals, patterns, safety
        {social?.available ? ", social" : ""}{sig.ai ? ", and AI" : ""} — <b>not</b> a
        guaranteed prediction. No tool can reliably predict memecoin direction. Trade at your own risk.
      </p>
    </div>
  );
}
