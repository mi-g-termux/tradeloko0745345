"use client";
// /orders — limit / take-profit / stop-loss orders (feature #7). Create trigger
// orders; the keeper cron executes them. Requires trader+ role to create.
import { useEffect, useState } from "react";

interface Order {
  id: string;
  token_address: string;
  symbol: string | null;
  side: string;
  trigger_type: string;
  trigger_price: number;
  amount_sol: number | null;
  status: string;
  created_at: string;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    tokenAddress: "",
    side: "buy",
    triggerType: "price_below",
    triggerPrice: "",
    amountSol: "",
  });

  async function load() {
    const d = await fetch("/api/limit-orders").then((r) => r.json());
    setOrders(d.orders ?? []);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setMsg(null);
    const res = await fetch("/api/limit-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenAddress: form.tokenAddress.trim(),
        side: form.side,
        triggerType: form.triggerType,
        triggerPrice: Number(form.triggerPrice),
        amountSol: form.side === "buy" ? Number(form.amountSol) : undefined,
      }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error ?? "Failed"); return; }
    setForm({ ...form, tokenAddress: "", triggerPrice: "", amountSol: "" });
    load();
  }

  async function cancel(id: string) {
    await fetch(`/api/limit-orders?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Limit / TP / SL orders</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Set a trigger price and the keeper executes automatically. Buys and
        take-profit/stop-loss sells are signed with your own in-app wallet and paid
        from your balance,
        behind the same safety + spend caps.
      </p>

      <div className="mt-5 grid gap-2 rounded-xl border border-[#1a1f2e] bg-[#0f1117] p-4 sm:grid-cols-2">
        <input
          value={form.tokenAddress}
          onChange={(e) => setForm({ ...form, tokenAddress: e.target.value })}
          placeholder="Token mint address"
          className="rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-zinc-100 outline-none sm:col-span-2"
        />
        <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} className="rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-zinc-100">
          <option value="buy">Buy</option>
          <option value="sell">Sell (TP/SL)</option>
        </select>
        <select value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })} className="rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-zinc-100">
          <option value="price_below">When price ≤ trigger</option>
          <option value="price_above">When price ≥ trigger</option>
        </select>
        <input
          value={form.triggerPrice}
          onChange={(e) => setForm({ ...form, triggerPrice: e.target.value })}
          placeholder="Trigger price (USD)"
          className="rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-zinc-100"
        />
        {form.side === "buy" && (
          <input
            value={form.amountSol}
            onChange={(e) => setForm({ ...form, amountSol: e.target.value })}
            placeholder="Amount SOL (buys)"
            className="rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-zinc-100"
          />
        )}
        <button onClick={create} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 sm:col-span-2">
          Create order
        </button>
        {msg && <p className="text-sm text-red-400 sm:col-span-2">{msg}</p>}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-[#1a1f2e]">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1117] text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Token</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Trigger</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">No orders yet.</td></tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-[#1a1f2e]">
                <td className="px-3 py-2 text-zinc-200">{o.symbol ?? o.token_address.slice(0, 6)}</td>
                <td className="px-3 py-2 text-zinc-400">{o.side}</td>
                <td className="px-3 py-2 text-zinc-400">{o.trigger_type === "price_below" ? "≤" : "≥"} ${o.trigger_price}</td>
                <td className="px-3 py-2 text-zinc-400">{o.amount_sol ? `${o.amount_sol} SOL` : "—"}</td>
                <td className="px-3 py-2">
                  <span className={o.status === "filled" ? "text-emerald-400" : o.status === "open" ? "text-amber-400" : "text-zinc-500"}>{o.status}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  {o.status === "open" && (
                    <button onClick={() => cancel(o.id)} className="text-xs text-red-400 hover:underline">Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
