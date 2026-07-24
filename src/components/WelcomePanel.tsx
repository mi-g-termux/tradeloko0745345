"use client";
// First-visit welcome panel for the home page. It auto-opens only ONCE (the very
// first time a browser lands on the site); after that it stays collapsed behind a
// small "Show what this tool can do" link. Dismiss also collapses it.
import { useEffect, useState } from "react";
import FeatureGrid from "./FeatureGrid";

const SEEN_KEY = "mp_welcome_seen";

export default function WelcomePanel() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const seen = localStorage.getItem(SEEN_KEY) === "1";
    setDismissed(seen);
    // Mark as seen immediately so it never auto-opens again.
    if (!seen) localStorage.setItem(SEEN_KEY, "1");
  }, []);

  if (dismissed) {
    return (
      <button
        onClick={() => setDismissed(false)}
        className="mb-4 text-xs text-zinc-500 underline hover:text-zinc-300"
      >
        Show what this tool can do
      </button>
    );
  }

  return (
    <section className="mb-6 rounded-2xl border border-[#1a1f2e] bg-gradient-to-b from-[#0f1117] to-[#0a0c10] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Welcome to MemePump</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Everything runs on real Solana data. Scan trending tokens, catch new launches, check
            rug-safety, read directional signals (with a tracked hit-rate), track whales, buy through
            Jupiter, and automate with copy-trade, auto-buy and limit orders. Here is every option:
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-lg border border-[#1a1f2e] px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-4"><FeatureGrid compact /></div>
      <p className="mt-4 text-xs text-zinc-500">
        Memecoins are extremely high risk. Signals are probabilities, not guarantees. Only risk what you can afford to lose.
      </p>
    </section>
  );
}
