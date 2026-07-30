"use client";
// /boost - token teams buy promotion on this site.
//
// Two payment paths, both automatic:
//   1. Pay from the in-app wallet: one click, the server signs the transfer with
//      the buyer's own custodial key and the boost activates immediately.
//   2. Pay from any external wallet: send the exact amount to the shown address
//      and submit the signature. The server verifies the transfer on-chain
//      before activating - a signature alone proves nothing until checked.
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Rocket, Wallet } from "lucide-react";
import { Badge, Button, Field, TextInput } from "@/components/ui";

interface Pkg {
  tier: number;
  priceSol: number;
  hours: number;
}
interface Order {
  id: string;
  tokenAddress: string;
  tier: number;
  priceSol: number;
  durationHours: number;
  reference: string;
  payTo: string;
  status: string;
  signature: string | null;
  expiresAt: string | null;
  createdAt: string;
}

function tierName(tier: number): string {
  return tier === 1 ? "Starter" : tier === 2 ? "Growth" : "Headline";
}

function durationLabel(hours: number): string {
  if (hours < 24) return hours + "h";
  const days = Math.round(hours / 24);
  return days + (days === 1 ? " day" : " days");
}

export default function BoostPage() {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [balance, setBalance] = useState(0);

  const [token, setToken] = useState("");
  const [tier, setTier] = useState<number | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/boost");
      const j = await r.json();
      setReady(Boolean(j.ready));
      setSignedIn(Boolean(j.signedIn));
      setPackages(Array.isArray(j.packages) ? j.packages : []);
      setOrders(Array.isArray(j.orders) ? j.orders : []);
      setBalance(Number(j.balanceSol ?? 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createOrder() {
    if (!token.trim() || tier == null) {
      setMsg({ ok: false, text: "Paste your token mint address and pick a package." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/boost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenAddress: token.trim(), tier }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Could not start that order.");
      setOrder(j.order);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function payFromWallet() {
    if (!order) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/boost/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Payment failed.");
      setMsg({ ok: true, text: "Boost is live. It runs until " + new Date(j.expiresAt).toLocaleString() + "." });
      setOrder(null);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function confirmExternal() {
    if (!order) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/boost/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, signature: signature.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Could not verify that payment.");
      setMsg({ ok: true, text: "Payment verified. Boost runs until " + new Date(j.expiresAt).toLocaleString() + "." });
      setOrder(null);
      setSignature("");
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="skeleton h-64" />;

  if (!ready) {
    return (
      <div className="card space-y-2 p-5">
        <div className="flex items-center gap-2 font-bold text-ink">
          <Rocket size={16} /> Token boosts
        </div>
        <p className="text-sm text-mute">
          Boosts are not on sale right now. If you own this site, open the admin panel, set a boost
          payout wallet and at least one package price, then turn boosts on.
        </p>
      </div>
    );
  }

  const canAfford = order ? balance >= order.priceSol + 0.003 : false;

  return (
    <div className="space-y-4">
      <div className="card space-y-1 p-5">
        <div className="flex items-center gap-2 text-lg font-bold text-ink">
          <Rocket size={18} /> Boost your token
        </div>
        <p className="text-sm text-mute">
          Put your token at the top of the Trending feed on this site. Boosted tokens rank above
          organic results and carry a visible Boosted badge, so traders always know it is paid
          placement.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {packages.map((p) => (
          <button
            key={p.tier}
            onClick={() => {
              setTier(p.tier);
              setOrder(null);
            }}
            className={
              "card p-4 text-left transition " +
              (tier === p.tier ? "border-accent shadow-glow" : "hover:border-edge2")
            }
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">{tierName(p.tier)}</span>
              {p.tier === 3 ? <Badge tone="accent">top slot</Badge> : null}
            </div>
            <div className="mt-2 font-mono text-xl text-ink">{p.priceSol} SOL</div>
            <div className="text-xs text-mute">runs for {durationLabel(p.hours)}</div>
          </button>
        ))}
      </div>

      <div className="card space-y-3 p-4">
        <Field label="Token mint address" hint="The SPL mint of the token you want promoted.">
          <TextInput
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="e.g. 7xKX...pump"
            className="font-mono"
          />
        </Field>

        {!signedIn ? (
          <div className="flex items-start gap-2 rounded-card border border-edge2 bg-panel2 p-3 text-xs text-mute">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-warn" />
            <div>
              <div className="text-ink">Sign in first</div>
              Boosts are tied to your account so you can check their status later.
            </div>
          </div>
        ) : null}

        {!order ? (
          <Button variant="primary" size="md" onClick={createOrder} disabled={busy || !signedIn}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Continue to payment
          </Button>
        ) : (
          <div className="space-y-3 rounded-card border border-edge2 bg-panel2 p-3">
            <div className="text-sm text-ink">
              {tierName(order.tier)} boost - <b>{order.priceSol} SOL</b> - {durationLabel(order.durationHours)}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <Wallet size={13} /> Pay from your in-app wallet
              </div>
              <div className="text-xs text-mute">
                Balance <b className="text-ink">{balance.toFixed(4)} SOL</b>
              </div>
              <Button
                variant="success"
                size="md"
                onClick={payFromWallet}
                disabled={busy || !canAfford}
                title={canAfford ? undefined : "Not enough balance in your in-app wallet."}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Pay {order.priceSol} SOL and activate
              </Button>
              {!canAfford ? (
                <div className="text-xs text-mute">
                  Not enough balance in your in-app wallet.{" "}
                  <a href="/wallet" className="text-accent hover:underline">
                    Deposit SOL
                  </a>
                  , or pay from an external wallet below.
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-edge pt-3">
              <div className="text-xs font-semibold text-ink">Or pay from any wallet</div>
              <div className="text-xs text-mute">
                Send exactly <b className="text-ink">{order.priceSol} SOL</b> to:
              </div>
              <div className="break-all rounded border border-edge bg-base p-2 font-mono text-2xs text-ink">
                {order.payTo}
              </div>
              <div className="text-2xs text-faint">Reference {order.reference}</div>
              <TextInput
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Paste the transaction signature"
                className="font-mono"
              />
              <Button
                variant="outline"
                size="md"
                onClick={confirmExternal}
                disabled={busy || signature.trim().length < 20}
              >
                Verify payment
              </Button>
            </div>
          </div>
        )}

        {msg ? (
          <div className={"flex items-start gap-1.5 text-sm " + (msg.ok ? "text-up" : "text-down")}>
            {msg.ok ? (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
            )}
            <span>{msg.text}</span>
          </div>
        ) : null}
      </div>

      {orders.length > 0 ? (
        <div className="card p-0">
          <div className="border-b border-edge px-4 py-2.5 text-sm font-semibold text-ink">
            Your boosts
          </div>
          <div className="scroll-x">
            <table className="w-full text-xs">
              <thead className="text-faint">
                <tr>
                  <th className="px-4 py-2 text-left">Token</th>
                  <th className="px-4 py-2 text-left">Package</th>
                  <th className="px-4 py-2 text-right">Paid</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Ends</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-edge">
                    <td className="px-4 py-2 font-mono text-mute">
                      {o.tokenAddress.slice(0, 4)}...{o.tokenAddress.slice(-4)}
                    </td>
                    <td className="px-4 py-2 text-ink">{tierName(o.tier)}</td>
                    <td className="px-4 py-2 text-right font-mono">{o.priceSol}</td>
                    <td className="px-4 py-2">
                      <Badge tone={o.status === "active" ? "up" : o.status === "pending" ? "warn" : "neutral"}>
                        {o.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-mute">
                      {o.expiresAt ? new Date(o.expiresAt).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
