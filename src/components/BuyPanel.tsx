"use client";
import { useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { CheckCircle2, XCircle } from "lucide-react";

type SolanaProvider = {
  publicKey?: { toBase58(): string };
  connect: () => Promise<{ publicKey: { toBase58(): string } }>;
  signAndSendTransaction?: (tx: VersionedTransaction) => Promise<{ signature: string }>;
};

function getProvider(): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { solana?: SolanaProvider };
  return w.solana ?? null;
}

// Non-custodial manual buy: quote -> build unsigned tx -> user's wallet signs
// and sends. The server NEVER sees the user's private key.
export function BuyPanel({ address, symbol }: { address: string; symbol: string }) {
  const [amount, setAmount] = useState("0.05");
  const [quote, setQuote] = useState<any>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function getQuote() {
    setBusy(true);
    setStatus(null);
    setQuote(null);
    try {
      const r = await fetch("/api/swap/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputMint: address, solAmount: Number(amount) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Quote failed");
      setQuote(j.quote);
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function buy() {
    setBusy(true);
    setStatus(null);
    try {
      const provider = getProvider();
      if (!provider) throw new Error("No Solana wallet found. Install Phantom.");
      const { publicKey } = await provider.connect();
      const build = await fetch("/api/swap/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: quote.raw, userPublicKey: publicKey.toBase58() }),
      });
      const bj = await build.json();
      if (!build.ok) throw new Error(bj.error ?? "Build failed");
      const tx = VersionedTransaction.deserialize(
        Buffer.from(bj.swapTransaction, "base64"),
      );
      if (!provider.signAndSendTransaction) {
        throw new Error("Wallet does not support signAndSendTransaction.");
      }
      const { signature } = await provider.signAndSendTransaction(tx);
      setStatus({ ok: true, text: `Submitted: ${signature.slice(0, 12)}…` });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="font-bold text-white mb-1">Buy {symbol}</div>
      <p className="text-xs text-slate-500 mb-3">
        Non-custodial: the swap is built by Jupiter and signed by <b>your</b> wallet.
        This app never holds your keys. Review the quote before signing.
      </p>
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28 bg-base border border-edge rounded-lg px-3 py-2 text-sm font-mono"
          />
          <span className="absolute right-2 top-2 text-xs text-slate-500">SOL</span>
        </div>
        <button
          onClick={getQuote}
          disabled={busy}
          className="px-3 py-2 rounded-lg text-sm bg-white/10 hover:bg-white/20 text-white disabled:opacity-50"
        >
          Get quote
        </button>
        {quote && (
          <button
            onClick={buy}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {busy ? "…" : `Buy ${symbol}`}
          </button>
        )}
      </div>
      {quote && (
        <div className="mt-3 text-xs text-slate-400 font-mono">
          ≈ {Number(quote.outAmount).toLocaleString()} {symbol} · price impact{" "}
          {Number(quote.priceImpactPct).toFixed(2)}%
        </div>
      )}
      {status && (
        <div className={`mt-3 flex items-center gap-1.5 text-sm ${status.ok ? "text-emerald-400" : "text-red-400"}`}>
          {status.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {status.text}
        </div>
      )}
    </div>
  );
}
