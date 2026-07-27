"use client";
// /portfolio - Photon-style trading dashboard.
//
// Three tabs over one wallet: current holdings, full activity (deposits and
// withdrawals included), and a per-day realised P&L calendar.
//
// HONESTY RULE FOR THIS PAGE
// --------------------------
// Invested / Sold / Winrate / Avg hold come from this app's own records, so
// they exist only for your own wallet. When you look up somebody else's address
// the chain can tell us balances but not intent, so those tiles render "N/A"
// instead of a fabricated number.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";
import { Badge, SegmentedControl, StatTile, Tabs, TextInput } from "@/components/ui";

interface Holding {
  tokenAddress: string;
  symbol: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  costSol: number | null;
}
interface Stats {
  investedSol: number;
  soldSol: number;
  realisedPnlSol: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number | null;
  avgHoldHours: number | null;
  lastTradedAt: string | null;
  depositedSol: number;
  withdrawnSol: number;
}
interface Portfolio {
  wallet: string;
  solBalance: number;
  holdings: Holding[];
  totalValueUsd: number;
  stats: Stats | null;
}
interface Tx {
  kind: string;
  token_address: string | null;
  sol_amount: number | null;
  signature: string | null;
  status: string;
  note: string | null;
  created_at: string;
}

type TabId = "holdings" | "activity" | "calendar";
type RangeId = "all" | "1d" | "7d" | "14d" | "30d";

const RANGE_DAYS: Record<RangeId, number | null> = {
  all: null,
  "1d": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

function usd(n: number | null | undefined): string {
  if (n == null) return "N/A";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function sol(n: number | null | undefined, dp = 3): string {
  if (n == null) return "N/A";
  return `${n.toFixed(dp)} SOL`;
}
function ago(iso: string | null): string {
  if (!iso) return "N/A";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "N/A";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function holdLabel(hours: number | null): string {
  if (hours == null) return "N/A";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
function short(s: string, n = 4): string {
  return s.length > n * 2 ? `${s.slice(0, n)}...${s.slice(-n)}` : s;
}

const KIND_TONE: Record<string, "up" | "down" | "accent" | "neutral"> = {
  deposit: "up",
  sell: "up",
  withdraw: "down",
  buy: "accent",
  fee: "neutral",
};

export default function PortfolioPage() {
  const [wallet, setWallet] = useState("");
  const [data, setData] = useState<Portfolio | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("holdings");
  const [range, setRange] = useState<RangeId>("all");
  const [q, setQ] = useState("");
  const [hideDust, setHideDust] = useState(true);
  // "no wallet yet" and "signed out" are STATES, not failures. Keeping them out
  // of `err` is what stops a developer string rendering as red error text.
  const [state, setState] = useState<string>("ok");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (address?: string) => {
    setLoading(true);
    setErr(null);
    try {
      const target = (address ?? "").trim();
      // Pull fresh on-chain history first so a deposit made a minute ago is
      // already in the activity list. Skipped for other people's wallets.
      if (!target) {
        await fetch("/api/wallet/sync", { method: "POST" }).catch(() => null);
      }
      const qs = target ? `?wallet=${encodeURIComponent(target)}` : "";
      const [p, t] = await Promise.all([
        fetch(`/api/portfolio${qs}`).then((r) => r.json()),
        target
          ? Promise.resolve({ transactions: [] })
          : fetch("/api/wallet/transactions")
              .then((r) => r.json())
              .catch(() => ({ transactions: [] })),
      ]);
      if (p.error) throw new Error(p.error);
      setState(String(p.state ?? "ok"));
      setData(p.portfolio);
      setTxs(t?.transactions ?? []);
    } catch (e) {
      setErr((e as Error).message);
      setData(null);
      setTxs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Generate the in-app trading wallet, then show it straight away. */
  async function createWallet() {
    setCreating(true);
    setErr(null);
    const r = await fetch("/api/wallet", { method: "POST" })
      .then((x) => x.json())
      .catch(() => ({ error: "Network error." }));
    setCreating(false);
    if (r?.error) {
      setErr(String(r.error));
      return;
    }
    await load();
  }

  const cutoff = useMemo(() => {
    const days = RANGE_DAYS[range as RangeId];
    return days == null ? 0 : Date.now() - days * 86_400_000;
  }, [range]);

  const visibleTxs = useMemo(
    () =>
      txs.filter((t) => {
        if (cutoff && Date.parse(t.created_at) < cutoff) return false;
        if (!q.trim()) return true;
        const hay = `${t.kind} ${t.token_address ?? ""} ${t.note ?? ""}`.toLowerCase();
        return hay.includes(q.trim().toLowerCase());
      }),
    [txs, cutoff, q],
  );

  const visibleHoldings = useMemo(() => {
    const list = data?.holdings ?? [];
    return list.filter((h) => {
      if (hideDust && (h.valueUsd ?? 0) < 1) return false;
      if (!q.trim()) return true;
      const hay = `${h.symbol} ${h.tokenAddress}`.toLowerCase();
      return hay.includes(q.trim().toLowerCase());
    });
  }, [data, hideDust, q]);

  /** Realised SOL per calendar day, from recorded sells minus buys. */
  const calendar = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const t of visibleTxs) {
      const amt = Number(t.sol_amount ?? 0);
      if (!Number.isFinite(amt) || amt === 0) continue;
      if (t.kind !== "buy" && t.kind !== "sell") continue;
      const day = t.created_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + (t.kind === "sell" ? amt : -amt));
    }
    const entries: Array<[string, number]> = [...byDay.entries()];
    return entries.sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [visibleTxs]);

  const st = data?.stats ?? null;
  const remaining = data ? data.totalValueUsd : null;

  // ── Onboarding ────────────────────────────────────────────────────────────
  // Shown INSTEAD of the dashboard when there is nothing to show yet. A grid of
  // "N/A" tiles over a red developer string is not an empty state; it reads as a
  // broken page. Tell the person what exists and give them the one button that
  // moves them forward.
  const lookingUpSomeoneElse = wallet.trim().length > 0;

  if (!lookingUpSomeoneElse && (state === "signed_out" || state === "no_wallet")) {
    const signedOut = state === "signed_out";
    return (
      <main className="mx-auto max-w-3xl px-3 py-10 sm:px-4">
        <div className="card p-6 text-center sm:p-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-panel2">
            <Wallet size={22} className="text-accent" />
          </div>

          <h1 className="mt-4 text-lg font-semibold text-ink">
            {signedOut ? "Sign in to see your portfolio" : "Create your trading wallet"}
          </h1>

          <p className="mx-auto mt-2 max-w-lg text-sm text-mute">
            {signedOut
              ? "Your portfolio tracks the in-app trading wallet on this site. Sign in first, then create the wallet in one click."
              : "MemePump trades from its own in-app wallet, not from the wallet you signed in with. Create it once, deposit SOL into it, and every buy, sell, deposit and withdrawal shows up here automatically."}
          </p>

          {/* The distinction that causes the most confusion, stated plainly. */}
          <div className="mx-auto mt-5 max-w-lg space-y-2 text-left">
            <div className="rounded-card border border-edge bg-panel2/60 p-3">
              <p className="text-xs font-medium text-ink">
                Your connected wallet (Phantom)
              </p>
              <p className="mt-0.5 text-2xs text-mute">
                Used only to prove who you are. This site cannot see its history
                or sign anything with it, so it is never shown here.
              </p>
            </div>
            <div className="rounded-card border border-accent/40 bg-accent/5 p-3">
              <p className="text-xs font-medium text-ink">
                Your in-app trading wallet
              </p>
              <p className="mt-0.5 text-2xs text-mute">
                The account you deposit into and trade from. You can export its
                private key at any time and withdraw whenever you want.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {signedOut ? (
              <a
                href="/wallet"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Sign in
              </a>
            ) : (
              <button
                type="button"
                onClick={createWallet}
                disabled={creating}
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {creating ? <Loader2 size={15} className="animate-spin" /> : null}
                {creating ? "Creating..." : "Create trading wallet"}
              </button>
            )}
            <a
              href="/wallet"
              className="rounded-md border border-edge px-4 py-2 text-sm text-mute hover:text-ink"
            >
              Go to Wallet
            </a>
          </div>

          {err ? (
            <p className="mt-4 text-xs text-down">{err}</p>
          ) : null}

          <div className="mt-8 border-t border-edge pt-5">
            <p className="text-2xs uppercase tracking-wide text-faint">
              Just browsing?
            </p>
            <div className="mx-auto mt-2 flex max-w-md items-center gap-2">
              <TextInput
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") load(wallet);
                }}
                placeholder="Look up any Solana wallet address..."
                className="font-mono"
              />
              <button
                type="button"
                onClick={() => load(wallet)}
                className="shrink-0 rounded-md border border-edge px-3 py-2 text-xs text-mute hover:text-ink"
              >
                Look up
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
      <div className="card p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wallet size={18} className="text-accent" />
            <h1 className="text-base font-semibold text-ink">
              {data?.wallet ? short(data.wallet, 5) : "My Wallet"}
            </h1>
            {data ? (
              <>
                <Badge tone="accent">{sol(data.solBalance, 4)}</Badge>
                <span className="text-xs text-mute">{usd(remaining)}</span>
              </>
            ) : (
              <span className="text-xs text-faint">loading...</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <SegmentedControl<RangeId>
              value={range}
              onChange={setRange}
              options={[
                { value: "all", label: "All" },
                { value: "1d", label: "1d" },
                { value: "7d", label: "7d" },
                { value: "14d", label: "14d" },
                { value: "30d", label: "30d" },
              ]}
            />
            <button
              type="button"
              onClick={() => load(wallet)}
              disabled={loading}
              title="Reload from chain"
              className="flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-xs text-mute hover:text-ink disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <StatTile label="Invested" value={sol(st?.investedSol ?? null)} />
          <StatTile label="Remaining" value={usd(remaining)} />
          <StatTile label="Sold" value={sol(st?.soldSol ?? null)} />
          <StatTile
            label="Realised P&L"
            value={
              st ? (
                <span className={st.realisedPnlSol >= 0 ? "text-up" : "text-down"}>
                  {st.realisedPnlSol >= 0 ? "+" : ""}
                  {st.realisedPnlSol.toFixed(3)} SOL
                </span>
              ) : (
                "N/A"
              )
            }
          />
          <StatTile label="Traded" value={st ? String(st.tradeCount) : "N/A"} />
          <StatTile
            label="Winrate"
            value={st?.winRate != null ? `${st.winRate.toFixed(0)}%` : "N/A"}
            sub={
              st && st.winCount + st.lossCount > 0
                ? `${st.winCount}W / ${st.lossCount}L`
                : undefined
            }
          />
          <StatTile label="Avg hold" value={holdLabel(st?.avgHoldHours ?? null)} />
          <StatTile label="Last traded" value={ago(st?.lastTradedAt ?? null)} />
        </div>

        {st ? (
          <p className="mt-2 text-2xs text-faint">
            Deposited {sol(st.depositedSol)} - withdrawn {sol(st.withdrawnSol)}. Wins
            are counted only where the cost basis is known, so an unknown buy is
            never scored as a loss.
          </p>
        ) : (
          <p className="mt-2 text-2xs text-faint">
            Trading stats are only available for your own wallet - the chain shows
            balances, not what an address paid.
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <TextInput
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load(wallet);
            }}
            placeholder="Look up any Solana wallet address..."
            className="pl-8 font-mono"
          />
        </div>
        {wallet ? (
          <button
            type="button"
            onClick={() => {
              setWallet("");
              load();
            }}
            className="rounded-md border border-edge px-3 py-2 text-xs text-mute hover:text-ink"
          >
            Back to my wallet
          </button>
        ) : null}
      </div>

      {/* Viewing a stranger's address is read-only by definition: we hold no
          records for it, so the trading tiles stay N/A. Say so, rather than
          letting the user assume the numbers are broken. */}
      {state === "foreign" ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-edge bg-panel2/60 px-3 py-2">
          <Eye size={14} className="mt-0.5 shrink-0 text-mute" />
          <p className="text-xs text-mute">
            Read-only view of someone else&apos;s wallet. Balances are live from
            the chain, but invested, winrate and hold time need trade records we
            only have for your own wallet.
          </p>
        </div>
      ) : null}

      {err ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-down/40 bg-down/10 px-3 py-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-down" />
          <div className="text-xs">
            <p className="font-medium text-down">Could not load that wallet</p>
            <p className="mt-0.5 text-mute">{err}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "holdings", label: "My Holdings", count: visibleHoldings.length },
            { value: "activity", label: "Activity", count: visibleTxs.length },
            { value: "calendar", label: "P&L Calendar", count: calendar.length },
          ]}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <TextInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "holdings" ? "Search token..." : "Search activity..."}
            className="pl-8"
          />
        </div>
        {tab === "holdings" ? (
          <label className="flex items-center gap-2 text-xs text-mute">
            <input
              type="checkbox"
              checked={hideDust}
              onChange={(e) => setHideDust(e.target.checked)}
              className="accent-[var(--c-accent)]"
            />
            Hide dust (under $1)
          </label>
        ) : null}
      </div>

      {tab === "holdings" ? (
        <div className="card mt-3 overflow-hidden">
          {loading ? (
            <p className="px-3 py-10 text-center text-sm text-mute">
              Loading holdings...
            </p>
          ) : visibleHoldings.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-mute">
              No token holdings in this wallet.
            </p>
          ) : (
            <div className="scroll-x">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-edge text-2xs uppercase tracking-wide text-faint">
                    <th className="px-3 py-2 text-left">Token</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHoldings.map((h) => (
                    <tr
                      key={h.tokenAddress}
                      className="border-b border-edge/50 last:border-0 hover:bg-panel2/50"
                    >
                      <td className="px-3 py-2">
                        <a
                          href={`/token/${h.tokenAddress}`}
                          className="font-medium text-ink hover:text-accent"
                        >
                          {h.symbol}
                        </a>
                        <div className="font-mono text-2xs text-faint">
                          {short(h.tokenAddress)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-mute">
                        {h.amount.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-mute">
                        {h.priceUsd == null ? "N/A" : `$${h.priceUsd.toPrecision(4)}`}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">
                        {usd(h.valueUsd)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-faint">
                        {h.costSol == null ? "n/a" : sol(h.costSol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="card mt-3 overflow-hidden">
          {loading ? (
            <p className="px-3 py-10 text-center text-sm text-mute">
              Loading activity...
            </p>
          ) : visibleTxs.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-mute">
              No activity yet. Deposits appear here automatically once they confirm
              on-chain.
            </p>
          ) : (
            <div className="scroll-x">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-edge text-2xs uppercase tracking-wide text-faint">
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Details</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">When</th>
                    <th className="px-3 py-2 text-right">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTxs.map((t, i) => (
                    <tr
                      key={`${t.signature ?? "x"}-${i}`}
                      className="border-b border-edge/50 last:border-0 hover:bg-panel2/50"
                    >
                      <td className="px-3 py-2">
                        <Badge tone={KIND_TONE[t.kind] ?? "neutral"}>{t.kind}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-mute">
                        {t.token_address ? (
                          <a
                            href={`/token/${t.token_address}`}
                            className="font-mono hover:text-accent"
                          >
                            {short(t.token_address)}
                          </a>
                        ) : (
                          <span>{t.note ?? "transfer"}</span>
                        )}
                        {t.status !== "confirmed" ? (
                          <span className="ml-2 text-warn">{t.status}</span>
                        ) : null}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          t.kind === "deposit" || t.kind === "sell"
                            ? "text-up"
                            : t.kind === "withdraw"
                              ? "text-down"
                              : "text-ink"
                        }`}
                      >
                        {t.kind === "deposit" || t.kind === "sell" ? "+" : "-"}
                        {Number(t.sol_amount ?? 0).toFixed(4)} SOL
                      </td>
                      <td className="px-3 py-2 text-right text-2xs text-faint">
                        {ago(t.created_at)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {t.signature ? (
                          <a
                            href={`https://solscan.io/tx/${t.signature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-2xs text-accent hover:underline"
                          >
                            {short(t.signature, 4)}
                          </a>
                        ) : (
                          <span className="text-2xs text-faint">n/a</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "calendar" ? (
        <div className="card mt-3 p-3">
          {calendar.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-mute">
              No closed trades in this period.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {calendar.map(([day, pnl]: [string, number]) => (
                <div
                  key={day}
                  className={`rounded-card border p-2 ${
                    pnl >= 0 ? "border-up/40 bg-up/10" : "border-down/40 bg-down/10"
                  }`}
                >
                  <div className="text-2xs text-faint">{day}</div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      pnl >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {pnl >= 0 ? "+" : ""}
                    {pnl.toFixed(3)}
                  </div>
                  <div className="text-2xs text-faint">SOL</div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-2xs text-faint">
            Each day is recorded sells minus recorded buys for that date. Open
            positions are not included - unrealised value is in the Holdings tab.
          </p>
        </div>
      ) : null}
    </main>
  );
}
