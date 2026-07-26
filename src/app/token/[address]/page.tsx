"use client";
// Token detail page — rebuilt to match the DexScreener token layout:
// chart + tabbed lower panel on the left, a dense stat rail on the right.
//
// Honesty rules kept throughout: we only render metrics DexScreener/GeckoTerminal
// actually return. Where a DexScreener-style column is a proxy (TRADERS) it is
// labelled as such instead of being passed off as unique wallets.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ExternalLink,
  Globe,
  Send,
  Star,
  Twitter,
} from "lucide-react";
import type { SafetyReport, TokenSummary } from "@/lib/types";
import {
  ageLabel,
  compactUsd,
  count,
  pct,
  pctColor,
  shortAddr,
  usd,
} from "@/lib/format";
import { BuyPanel } from "@/components/BuyPanel";
import { SignalPanel } from "@/components/SignalPanel";
import { TopHolders } from "@/components/TopHolders";
import PriceChart from "@/components/PriceChart";
import AdSlot from "@/components/AdSlot";
import {
  Badge,
  Button,
  Field,
  Modal,
  SplitBar,
  Tabs,
  TextInput,
  cx,
  inputClass,
} from "@/components/ui";

type LowerTab = "signal" | "traders" | "safety" | "trade";

export default function TokenPage() {
  const params = useParams<{ address: string }>();
  const address = params.address;

  const [summary, setSummary] = useState<TokenSummary | null>(null);
  const [safety, setSafety] = useState<SafetyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [safetyLoading, setSafetyLoading] = useState(true);
  const [tab, setTab] = useState<LowerTab>("signal");

  const [watching, setWatching] = useState(false);
  const [watchMsg, setWatchMsg] = useState<string | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertPct, setAlertPct] = useState("50");
  const [alertDir, setAlertDir] = useState<"up" | "down">("up");
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    const r = await fetch(`/api/token/${address}`);
    const j = await r.json();
    setSummary(j.summary ?? null);
    setLoading(false);
  }, [address]);

  useEffect(() => {
    loadSummary();
    (async () => {
      const r = await fetch(`/api/safety/${address}`);
      const j = await r.json();
      setSafety(j.report ?? null);
      setSafetyLoading(false);
    })();
  }, [address, loadSummary]);

  // Live price refresh every 20s so the rail does not go stale while you read.
  useEffect(() => {
    const id = setInterval(loadSummary, 20_000);
    return () => clearInterval(id);
  }, [loadSummary]);

  useEffect(() => {
    fetch("/api/watchlist")
      .then((r) => (r.ok ? r.json() : { watchlist: [] }))
      .then((j) =>
        setWatching(
          (j.watchlist ?? []).some(
            (w: { token_address: string }) => w.token_address === address,
          ),
        ),
      )
      .catch(() => {});
  }, [address]);

  async function toggleWatch() {
    setWatchMsg(null);
    const r = watching
      ? await fetch(`/api/watchlist?token=${encodeURIComponent(address)}`, {
          method: "DELETE",
        })
      : await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenAddress: address }),
        });
    if (r.status === 401) {
      setWatchMsg("Sign in to use the watchlist.");
      return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setWatchMsg(j.error ?? "Failed");
      return;
    }
    setWatching(!watching);
  }

  async function createAlert() {
    setAlertMsg("Saving…");
    const r = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenAddress: address,
        direction: alertDir,
        pct: Number(alertPct),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setAlertMsg(
        r.status === 401 ? "Sign in to create alerts." : (j.error ?? "Failed"),
      );
      return;
    }
    setAlertMsg(
      `Alert armed: notify me when price moves ${alertDir === "up" ? "+" : "-"}${alertPct}% from now.`,
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-[320px]" />
      </div>
    );
  }

  /* ── Brand-new token fallback (kept from the original page) ── */
  if (!summary) {
    return (
      <div className="card space-y-3 p-5">
        <div className="font-bold text-ink">Brand-new token</div>
        <p className="text-sm text-mute">
          This token is not on DexScreener yet. Freshly-launched pump.fun tokens
          take a few minutes to be indexed by DEX aggregators, and they trade on
          the pump.fun bonding curve until they graduate to a DEX. In-app
          (Jupiter) buys work after graduation; until then, trade it on pump.fun.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={`https://pump.fun/${address}`} target="_blank" rel="noreferrer">
            <Button variant="success" size="md">
              Trade on Pump.fun <ExternalLink size={14} />
            </Button>
          </a>
          <a
            href={`https://dexscreener.com/solana/${address}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="outline" size="md">
              DexScreener <ExternalLink size={14} />
            </Button>
          </a>
          <a
            href={`https://solscan.io/token/${address}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="outline" size="md">
              Solscan <ExternalLink size={14} />
            </Button>
          </a>
          <Button
            variant="outline"
            size="md"
            onClick={() => navigator.clipboard?.writeText(address)}
          >
            Copy CA
          </Button>
          <Button variant="ghost" size="md" onClick={() => location.reload()}>
            Retry
          </Button>
        </div>
        <div className="break-all font-mono text-2xs text-faint">{address}</div>
      </div>
    );
  }

  const buys = summary.txns24hBuys ?? 0;
  const sells = summary.txns24hSells ?? 0;
  const verdictTone =
    safety?.verdict === "ok"
      ? "border-up/30 bg-up/5 text-up"
      : safety?.verdict === "caution"
        ? "border-warn/30 bg-warn/5 text-warn"
        : "border-down/30 bg-down/5 text-down";

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        {summary.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={summary.imageUrl}
            alt=""
            className="h-10 w-10 rounded-full bg-panel2 object-cover"
          />
        ) : (
          <span className="grid h-10 w-10 place-items-center rounded-full bg-panel2 text-xs font-bold text-mute">
            {(summary.symbol || "?").slice(0, 3)}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-ink">{summary.symbol}</span>
            <span className="text-sm text-faint">
              /{summary.quoteSymbol ?? "SOL"}
            </span>
            <span className="truncate text-sm text-mute">{summary.name}</span>
            {summary.boosts ? <Badge tone="warn">⚡ boosted</Badge> : null}
            {summary.dexId ? <Badge tone="neutral">{summary.dexId}</Badge> : null}
          </div>
          <button
            onClick={() => navigator.clipboard?.writeText(summary.address)}
            className="font-mono text-2xs text-faint hover:text-mute"
            title="Copy contract address"
          >
            {shortAddr(summary.address)} · copy
          </button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {summary.websiteUrl ? (
            <a href={summary.websiteUrl} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <Globe size={13} /> Website
              </Button>
            </a>
          ) : null}
          {summary.twitterUrl ? (
            <a href={summary.twitterUrl} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <Twitter size={13} /> Twitter
              </Button>
            </a>
          ) : null}
          {summary.telegramUrl ? (
            <a href={summary.telegramUrl} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <Send size={13} /> Telegram
              </Button>
            </a>
          ) : null}
          <Button
            variant={watching ? "success" : "outline"}
            onClick={toggleWatch}
            title="Watchlisted tokens drive your personal alerts"
          >
            <Star size={13} /> {watching ? "Watching" : "Watchlist"}
          </Button>
          <Button variant="outline" onClick={() => setAlertOpen(true)}>
            <Bell size={13} /> Alert
          </Button>
        </div>
      </div>
      {watchMsg ? <p className="text-2xs text-warn">{watchMsg}</p> : null}

      <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
        {/* ── Left: chart + tabs ── */}
        <div className="min-w-0 space-y-3">
          <PriceChart
            address={summary.address}
            priceUsd={summary.priceUsd}
            marketCap={summary.marketCap ?? summary.fdv}
            quoteSymbol={summary.quoteSymbol}
          />

          <Tabs
            tabs={[
              { value: "signal", label: "Analysis & signal" },
              { value: "traders", label: "Top holders" },
              { value: "safety", label: "Safety" },
              { value: "trade", label: "Trade" },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === "signal" ? <SignalPanel address={summary.address} /> : null}
          {tab === "traders" ? <TopHolders address={summary.address} /> : null}
          {tab === "trade" ? (
            <BuyPanel address={summary.address} symbol={summary.symbol} />
          ) : null}
          {tab === "safety" ? (
            <div className={cx("card border p-4", verdictTone)}>
              <div className="text-xs font-bold uppercase tracking-wide">
                Safety:{" "}
                {safetyLoading
                  ? "analyzing…"
                  : `${safety?.score ?? 0}/100 · ${safety?.verdict ?? "unknown"}`}
              </div>
              {safety ? (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {safety.factors.map((f) => (
                    <li key={f.key} className="flex items-start gap-2">
                      {f.ok ? (
                        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-up" />
                      ) : (
                        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
                      )}
                      <span className="text-ink">
                        <b>{f.label}.</b>{" "}
                        <span className="text-mute">{f.detail}</span>
                      </span>
                    </li>
                  ))}
                  {safety.notes.map((n, i) => (
                    <li key={`n${i}`} className="pl-6 text-2xs text-faint">
                      {n}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-2xs text-mute">
                A high safety score means fewer obvious rug signals. It is NOT a
                prediction that the price will rise.
              </p>
            </div>
          ) : null}

          <AdSlot slot="token_page" />
        </div>

        {/* ── Right: stat rail ── */}
        <aside className="space-y-3">
          <div className="card divide-y divide-edge">
            <div className="grid grid-cols-2 divide-x divide-edge">
              <Tile label="Price USD" value={usd(summary.priceUsd)} big />
              <Tile
                label="Age"
                value={ageLabel(summary.ageHours)}
                big
              />
            </div>
            <div className="grid grid-cols-3 divide-x divide-edge">
              <Tile label="Liquidity" value={compactUsd(summary.liquidityUsd)} />
              <Tile label="FDV" value={compactUsd(summary.fdv)} />
              <Tile label="Mkt Cap" value={compactUsd(summary.marketCap)} />
            </div>
            <div className="grid grid-cols-4 divide-x divide-edge">
              {[
                { l: "5M", v: summary.priceChange5m },
                { l: "1H", v: summary.priceChange1h },
                { l: "6H", v: summary.priceChange6h },
                { l: "24H", v: summary.priceChange24h },
              ].map((c) => (
                <div key={c.l} className="px-2 py-2 text-center">
                  <div className="text-2xs uppercase tracking-wide text-faint">
                    {c.l}
                  </div>
                  <div className={cx("text-xs font-semibold", pctColor(c.v))}>
                    {pct(c.v)}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 divide-x divide-edge">
              <Tile label="Txns 24h" value={count(summary.txns24h ?? buys + sells)} />
              <Tile label="Volume 24h" value={compactUsd(summary.volume24h)} />
              <Tile
                label="Traders"
                value={count(summary.traders24h)}
                hint="Activity proxy (buys + sells), not unique wallets — DexScreener's free API does not expose makers."
              />
            </div>

            {/* Buy vs sell pressure, DexScreener-style split bars */}
            <div className="space-y-2 p-3">
              <SplitBar
                label="Buys vs sells (24h)"
                leftLabel={`${count(buys)} buys`}
                rightLabel={`${count(sells)} sells`}
                left={buys}
                right={sells}
              />
              {summary.buys5m != null || summary.sells5m != null ? (
                <SplitBar
                  label="Buys vs sells (5m)"
                  leftLabel={`${count(summary.buys5m)} buys`}
                  rightLabel={`${count(summary.sells5m)} sells`}
                  left={summary.buys5m ?? 0}
                  right={summary.sells5m ?? 0}
                />
              ) : null}
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                {[
                  { l: "Vol 5M", v: summary.volume5m },
                  { l: "Vol 1H", v: summary.volume1h },
                  { l: "Vol 6H", v: summary.volume6h },
                ].map((c) => (
                  <div key={c.l}>
                    <div className="text-2xs uppercase text-faint">{c.l}</div>
                    <div className="text-xs text-ink">{compactUsd(c.v)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card space-y-2 p-3">
            <a
              href={`https://jup.ag/swap/SOL-${summary.address}`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <Button variant="primary" size="md" className="w-full justify-center">
                Trade on Jupiter <ExternalLink size={14} />
              </Button>
            </a>
            {summary.url ? (
              <a href={summary.url} target="_blank" rel="noreferrer" className="block">
                <Button variant="outline" className="w-full justify-center">
                  Open on DexScreener <ExternalLink size={13} />
                </Button>
              </a>
            ) : null}
            <a
              href={`https://solscan.io/token/${summary.address}`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <Button variant="ghost" className="w-full justify-center">
                Solscan <ExternalLink size={13} />
              </Button>
            </a>
          </div>

          <AdSlot slot="sidebar" />
        </aside>
      </div>

      {/* ── Alert modal ── */}
      <Modal
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        title={`Price alert · ${summary.symbol}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAlertOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={createAlert}>
              Arm alert
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-2xs text-mute">
            The move is measured from the price at the moment you arm the alert
            ({usd(summary.priceUsd)}). Alerts are delivered to the Telegram chat
            id or email on your Account page.
          </p>
          <Field label="Direction">
            <select
              value={alertDir}
              onChange={(e) => setAlertDir(e.target.value as "up" | "down")}
              className={inputClass}
            >
              <option value="up">Price rises by</option>
              <option value="down">Price falls by</option>
            </select>
          </Field>
          <Field label="Percent move (%)">
            <TextInput
              inputMode="decimal"
              value={alertPct}
              onChange={(e) => setAlertPct(e.target.value)}
            />
          </Field>
          {alertMsg ? <p className="text-2xs text-mute">{alertMsg}</p> : null}
        </div>
      </Modal>
    </div>
  );
}

function Tile({
  label,
  value,
  big,
  hint,
}: {
  label: string;
  value: string;
  big?: boolean;
  hint?: string;
}) {
  return (
    <div className="px-3 py-2" title={hint}>
      <div className="text-2xs uppercase tracking-wide text-faint">{label}</div>
      <div
        className={cx(
          "font-semibold text-ink",
          big ? "text-base" : "text-xs",
        )}
      >
        {value}
      </div>
    </div>
  );
}
