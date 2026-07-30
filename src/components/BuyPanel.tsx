"use client";
import { useCallback, useEffect, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Button, SegmentedControl, TextInput } from "@/components/ui";

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

// Two ways to buy, and BOTH are kept:
//
//  "app"     (default) - paid from the wallet the user created on this site.
//                        The server signs with that user's own custodial key,
//                        so the SOL leaves THEIR balance. No extension needed.
//  "phantom"           - the original non-custodial path. The server builds an
//                        unsigned swap and the user's own extension signs it.
//                        Kept for people who want to hold their own keys.
//
// Nothing here can ever spend the platform's wallet.
type Mode = "app" | "phantom";

// Leave enough behind for network + priority fees, or the swap fails on-chain
// after the user has already waited for it.
const FEE_HEADROOM = 0.003;

export function BuyPanel({ address, symbol }: { address: string; symbol: string }) {
  const [mode, setMode] = useState<Mode>("app");
  const [amount, setAmount] = useState("0.05");
  const [quote, setQuote] = useState<any>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [signedIn, setSignedIn] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [balance, setBalance] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const loadWallet = useCallback(async () => {
    try {
      const r = await fetch("/api/wallet");
      if (r.status === 401) {
        setSignedIn(false);
        setHasWallet(false);
        setBalance(0);
        return;
      }
      const j = await r.json();
      setSignedIn(true);
      setHasWallet(Boolean(j.exists));
      setBalance(Number(j.balanceSol ?? 0));
    } catch {
      // Leave the last known state alone rather than falsely claiming 0.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;

  /**
   * Why the in-app buy is blocked, in plain language, or null if it is fine.
   * Checked again on the server - this is a courtesy, not the security border.
   */
  function appBlockReason(): string | null {
    if (!loaded) return null;
    if (!signedIn) return "Sign in to trade from your in-app wallet.";
    if (!hasWallet) {
      return "You have not created your in-app wallet yet. Create one on the Wallet page, then deposit SOL.";
    }
    if (balance <= 0) {
      return "Your in-app wallet balance is 0 SOL. Deposit SOL on the Wallet page before trading.";
    }
    if (!amountValid) return "Enter an amount greater than 0.";
    if (balance < amountNum + FEE_HEADROOM) {
      return (
        "Not enough balance. You have " +
        balance.toFixed(4) +
        " SOL and this trade needs about " +
        (amountNum + FEE_HEADROOM).toFixed(4) +
        " SOL including network fees."
      );
    }
    return null;
  }

  const blocked = mode === "app" ? appBlockReason() : null;

  async function getQuote() {
    setBusy(true);
    setStatus(null);
    setQuote(null);
    try {
      const r = await fetch("/api/swap/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputMint: address, solAmount: amountNum }),
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

  /** Buy paid from the user's own in-app wallet balance. */
  async function buyFromAppWallet() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch("/api/wallet/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenAddress: address, side: "buy", amountSol: amountNum }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Trade failed");
      setStatus({
        ok: true,
        text: "Bought " + symbol + " · " + String(j.signature ?? "").slice(0, 12) + "…",
      });
      await loadWallet();
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  /** Original non-custodial path: the user's own extension signs. */
  async function buyWithPhantom() {
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
      setStatus({ ok: true, text: "Submitted: " + signature.slice(0, 12) + "…" });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-bold text-ink">Buy {symbol}</div>
        <SegmentedControl<Mode>
          size="xs"
          value={mode}
          onChange={setMode}
          options={[
            { value: "app", label: "My wallet", title: "Pay from your in-app wallet balance" },
            { value: "phantom", label: "Phantom", title: "Sign with your own browser wallet" },
          ]}
        />
      </div>

      {mode === "app" ? (
        <p className="mb-3 text-xs text-mute">
          Paid from your in-app wallet{" "}
          <span className="font-mono text-ink">{balance.toFixed(4)} SOL</span>. Signed with
          your own wallet key, so the SOL comes out of your balance.
        </p>
      ) : (
        <p className="mb-3 text-xs text-mute">
          Non-custodial: the swap is built for you and signed by <b>your</b> browser
          wallet. This app never holds those keys. Review the quote before signing.
        </p>
      )}

      <a
        href={"https://pump.fun/coin/" + address}
        target="_blank"
        rel="noreferrer"
        className="mb-3 inline-block text-xs text-accent hover:underline"
      >
        New or pre-graduation token? Trade it on Pump.fun instead
      </a>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <TextInput
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28 pr-10 font-mono"
            inputMode="decimal"
          />
          <span className="pointer-events-none absolute right-3 top-2 text-xs text-faint">
            SOL
          </span>
        </div>
        {[0.05, 0.1, 0.5].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAmount(String(v))}
            className="rounded-card border border-edge px-2 py-1 text-xs text-mute hover:text-ink"
          >
            {v}
          </button>
        ))}

        {mode === "app" ? (
          <Button
            variant="success"
            onClick={buyFromAppWallet}
            disabled={busy || Boolean(blocked)}
          >
            {busy ? "Buying…" : "Buy " + symbol}
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={getQuote} disabled={busy || !amountValid}>
              Get quote
            </Button>
            {quote ? (
              <Button variant="success" onClick={buyWithPhantom} disabled={busy}>
                {busy ? "…" : "Buy " + symbol}
              </Button>
            ) : null}
          </>
        )}
      </div>

      {blocked ? (
        <div className="mt-3 flex items-start gap-2 rounded-card border border-edge bg-panel-2 p-3">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-warn" />
          <div className="text-xs text-mute">
            <div className="font-semibold text-ink">Trade blocked</div>
            {blocked}
            <div className="mt-1">
              <a href="/wallet" className="text-accent hover:underline">
                Go to your wallet
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {quote && mode === "phantom" ? (
        <div className="mt-3 font-mono text-xs text-mute">
          ≈ {Number(quote.outAmount).toLocaleString()} {symbol} · price impact{" "}
          {Number(quote.priceImpactPct).toFixed(2)}%
        </div>
      ) : null}

      {status ? (
        <div
          className={
            "mt-3 flex items-center gap-1.5 text-sm " +
            (status.ok ? "text-up" : "text-down")
          }
        >
          {status.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {status.text}
        </div>
      ) : null}
    </div>
  );
}
