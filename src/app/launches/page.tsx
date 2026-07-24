"use client";
// /launches — "New pairs": a live, real-time feed of freshly created pump.fun
// tokens (with logos + filters), streamed over a websocket. This is the
// brand-new-token view; the Scanner tab is for established / trending tokens.
import LiveLaunches from "@/components/LiveLaunches";

export default function LaunchesPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">New pairs</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Every new token the instant it is created — live, with logos. Use the
        filters to narrow by search, minimum market cap, or minimum dev buy. For
        established / trending coins, use the Scanner tab.
      </p>
      <div className="mt-4">
        <LiveLaunches />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        The feed starts empty and fills as new tokens launch (usually within
        seconds). Newest appears on top; click a row to open its chart and trade.
      </p>
    </main>
  );
}
