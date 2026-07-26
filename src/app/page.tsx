"use client";
// Scanner — rebuilt as a dense DexScreener-style market table.
//
// Everything visible here comes from the live /api/tokens response (DexScreener
// under the hood). Columns that DexScreener does not expose on its free API are
// labelled honestly rather than invented — e.g. TRADERS is the 24h transaction
// count, tooltipped as an activity proxy, not a unique-wallet count.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { TokenSummary } from "@/lib/types";
import {
  ageLabel,
  compactUsd,
  count,
  pct,
  pctColor,
  usd,
} from "@/lib/format";
import WelcomePanel from "@/components/WelcomePanel";
import MarketStrip, { CATEGORIES } from "@/components/MarketStrip";
import AdSlot from "@/components/AdSlot";
import {
  Badge,
  Button,
  Chip,
  Field,
  Modal,
  SegmentedControl,
  SortTh,
  TextInput,
  cx,
} from "@/components/ui";

type Feed = "trending" | "volume" | "gainers" | "new" | "searched";
type Frame = "m5" | "h1" | "h6" | "h24";
type SortCol =
  | "rank"
  | "price"
  | "age"
  | "txns"
  | "volume"
  | "traders"
  | "liquidity"
  | "mcap"
  | "m5"
  | "h1"
  | "h6"
  | "h24";

const FEEDS: Array<{ value: Feed; label: string }> = [
  { value: "trending", label: "Trending" },
  { value: "volume", label: "Top" },
  { value: "gainers", label: "Gainers" },
  { value: "new", label: "New pairs" },
  { value: "searched", label: "Most searched" },
];

const FRAMES: Array<{ value: Frame; label: string }> = [
  { value: "m5", label: "5M" },
  { value: "h1", label: "1H" },
  { value: "h6", label: "6H" },
  { value: "h24", label: "24H" },
];

/** Per-timeframe accessors so one set of columns serves every frame. */
function changeFor(t: TokenSummary, f: Frame): number | null {
  if (f === "m5") return t.priceChange5m ?? null;
  if (f === "h1") return t.priceChange1h ?? null;
  if (f === "h6") return t.priceChange6h ?? null;
  return t.priceChange24h ?? null;
}
function volumeFor(t: TokenSummary, f: Frame): number | null {
  if (f === "m5") return t.volume5m ?? null;
  if (f === "h1") return t.volume1h ?? null;
  if (f === "h6") return t.volume6h ?? null;
  return t.volume24h ?? null;
}
function txnsFor(t: TokenSummary, f: Frame): number | null {
  if (f === "m5") return t.txns5m ?? null;
  if (f === "h1") return t.txns1h ?? null;
  if (f === "h6") return t.txns6h ?? null;
  return t.txns24h ?? (t.txns24hBuys ?? 0) + (t.txns24hSells ?? 0);
}

interface Filters {
  minLiq: string;
  maxLiq: string;
  minMcap: string;
  maxMcap: string;
  minVol: string;
  minTxns: string;
  maxAgeH: string;
  minAgeH: string;
}

const EMPTY_FILTERS: Filters = {
  minLiq: "",
  maxLiq: "",
  minMcap: "",
  maxMcap: "",
  minVol: "",
  minTxns: "",
  maxAgeH: "",
  minAgeH: "",
};

const num = (v: string): number | null => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

export default function ScannerPage() {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [feed, setFeed] = useState<Feed>("trending");
  const [frame, setFrame] = useState<Frame>("h6");
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [sort, setSort] = useState<SortCol>("rank");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [category, setCategory] = useState<string | null>(null);
  const [quick, setQuick] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (submittedQ.trim()) params.set("q", submittedQ.trim());
      else params.set("sort", feed);
      const r = await fetch(`/api/tokens?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to load market data");
      setTokens(j.tokens ?? []);
      setUpdatedAt(new Date());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [feed, submittedQ]);

  useEffect(() => {
    load();
  }, [load]);

  // Live refresh every 30s, pausable so a user reading a row isn't yanked around.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((v) => v.trim() !== "").length,
    [filters],
  );

  const rows = useMemo(() => {
    const cat = category ? CATEGORIES.find((c) => c.id === category) : null;
    const f = {
      minLiq: num(filters.minLiq),
      maxLiq: num(filters.maxLiq),
      minMcap: num(filters.minMcap),
      maxMcap: num(filters.maxMcap),
      minVol: num(filters.minVol),
      minTxns: num(filters.minTxns),
      maxAgeH: num(filters.maxAgeH),
      minAgeH: num(filters.minAgeH),
    };

    let out = tokens.filter((t) => {
      const liq = t.liquidityUsd ?? 0;
      const mcap = (t.marketCap ?? t.fdv) ?? 0;
      const vol = volumeFor(t, frame) ?? 0;
      const tx = txnsFor(t, frame) ?? 0;
      const age = t.ageHours ?? 0;
      if (cat && !cat.match(t)) return false;
      if (f.minLiq != null && liq < f.minLiq) return false;
      if (f.maxLiq != null && liq > f.maxLiq) return false;
      if (f.minMcap != null && mcap < f.minMcap) return false;
      if (f.maxMcap != null && mcap > f.maxMcap) return false;
      if (f.minVol != null && vol < f.minVol) return false;
      if (f.minTxns != null && tx < f.minTxns) return false;
      if (f.maxAgeH != null && age > f.maxAgeH) return false;
      if (f.minAgeH != null && age < f.minAgeH) return false;

      // Quick chips
      if (quick === "boosted" && !(t.boosts ?? 0)) return false;
      if (quick === "fresh" && (t.ageHours ?? 999) > 6) return false;
      if (quick === "up" && (changeFor(t, frame) ?? 0) <= 0) return false;
      if (quick === "down" && (changeFor(t, frame) ?? 0) >= 0) return false;
      if (quick === "deep" && liq < 50_000) return false;
      return true;
    });

    if (sort !== "rank") {
      const get = (t: TokenSummary): number => {
        switch (sort) {
          case "price":
            return t.priceUsd ?? 0;
          case "age":
            return t.ageHours ?? 0;
          case "txns":
            return txnsFor(t, frame) ?? 0;
          case "volume":
            return volumeFor(t, frame) ?? 0;
          case "traders":
            return t.traders24h ?? 0;
          case "liquidity":
            return t.liquidityUsd ?? 0;
          case "mcap":
            return (t.marketCap ?? t.fdv) ?? 0;
          case "m5":
            return t.priceChange5m ?? 0;
          case "h1":
            return t.priceChange1h ?? 0;
          case "h6":
            return t.priceChange6h ?? 0;
          case "h24":
            return t.priceChange24h ?? 0;
          default:
            return 0;
        }
      };
      out = [...out].sort((a, b) =>
        dir === "asc" ? get(a) - get(b) : get(b) - get(a),
      );
    }
    return out;
  }, [tokens, category, filters, frame, quick, sort, dir]);

  const onSort = (c: SortCol) => {
    if (c === sort) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(c);
      setDir("desc");
    }
  };

  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setDraft(EMPTY_FILTERS);
    setCategory(null);
    setQuick(null);
  };

  return (
    <div className="space-y-3">
      <WelcomePanel />

      <MarketStrip
        tokens={tokens}
        activeCategory={category}
        onCategory={setCategory}
      />

      {/* ── Control bar ── */}
      <div className="card flex flex-wrap items-center gap-2 p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedQ(q);
          }}
          className="min-w-[200px] flex-1"
        >
          <TextInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / symbol / mint address…"
            className="h-9 py-0"
          />
        </form>

        <SegmentedControl
          options={FEEDS}
          value={feed}
          onChange={(v) => {
            setQ("");
            setSubmittedQ("");
            setFeed(v);
          }}
        />

        <SegmentedControl
          options={FRAMES.map((f) => ({
            ...f,
            title: `Rank and colour by the ${f.label} window`,
          }))}
          value={frame}
          onChange={setFrame}
        />

        <Button
          variant={activeFilterCount ? "primary" : "outline"}
          onClick={() => {
            setDraft(filters);
            setFiltersOpen(true);
          }}
        >
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </Button>

        <Button
          variant={autoRefresh ? "outline" : "ghost"}
          onClick={() => setAutoRefresh((v) => !v)}
          title="Pause or resume the 30-second live refresh"
        >
          {autoRefresh ? "Live ●" : "Paused"}
        </Button>

        <Button variant="ghost" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {/* ── Quick filter chips ── */}
      <div className="scroll-x flex items-center gap-2">
        {[
          { id: "boosted", label: "Boosted" },
          { id: "fresh", label: "New (<6h)" },
          { id: "up", label: "Gainers" },
          { id: "down", label: "Losers" },
          { id: "deep", label: "Liquidity > $50k" },
        ].map((c) => (
          <Chip
            key={c.id}
            active={quick === c.id}
            onClick={() => setQuick(quick === c.id ? null : c.id)}
          >
            {c.label}
          </Chip>
        ))}
        {(activeFilterCount || category || quick) && (
          <Button size="xs" variant="ghost" onClick={clearAll}>
            Clear all
          </Button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2 text-2xs text-faint">
          <span>{rows.length} pairs</span>
          {updatedAt ? <span>updated {updatedAt.toLocaleTimeString()}</span> : null}
        </div>
      </div>

      {err ? (
        <div className="card border-down/40 bg-down/5 px-3 py-2 text-xs text-down">
          {err}
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
        <div className="card overflow-hidden">
          <div className="max-h-[calc(100vh-260px)] overflow-auto">
            <table className="dtable">
              <thead>
                <tr>
                  {/* Phones keep only the columns a trader actually decides on:
                      rank, token, price, volume and 24h change. Everything else
                      appears as the viewport widens, so nothing is lost — it is
                      progressive disclosure rather than a 13-column sideways
                      scroll on a 390px screen. */}
                  <th className="w-8 sm:w-10">#</th>
                  <th className="text-left">Token</th>
                  <SortTh col="price" label="Price" sort={sort} dir={dir} onSort={onSort} />
                  <SortTh
                    col="age"
                    label="Age"
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className="hidden sm:table-cell"
                  />
                  <SortTh
                    col="txns"
                    label={`Txns ${frame.toUpperCase()}`}
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className="hidden lg:table-cell"
                  />
                  <SortTh
                    col="volume"
                    label={`Volume ${frame.toUpperCase()}`}
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                  />
                  <SortTh
                    col="traders"
                    label="Traders"
                    title="24h transaction count — an activity proxy. DexScreener's free API does not expose unique makers."
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className="hidden xl:table-cell"
                  />
                  <SortTh
                    col="m5"
                    label="5M"
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className="hidden lg:table-cell"
                  />
                  <SortTh
                    col="h1"
                    label="1H"
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className="hidden md:table-cell"
                  />
                  <SortTh
                    col="h6"
                    label="6H"
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className="hidden lg:table-cell"
                  />
                  <SortTh col="h24" label="24H" sort={sort} dir={dir} onSort={onSort} />
                  <SortTh
                    col="liquidity"
                    label="Liquidity"
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className="hidden md:table-cell"
                  />
                  <SortTh
                    col="mcap"
                    label="MCap"
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className="hidden sm:table-cell"
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr key={t.address}>
                    <td className="text-faint">
                      <span className="rounded bg-panel2 px-1.5 py-0.5 text-2xs">
                        {i + 1}
                      </span>
                    </td>
                    <td>
                      <Link
                        href={`/token/${t.address}`}
                        className="flex items-center gap-2"
                      >
                        {t.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={t.imageUrl}
                            alt=""
                            className="h-6 w-6 rounded-full bg-panel2 object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="grid h-6 w-6 place-items-center rounded-full bg-panel2 text-[9px] font-bold text-mute">
                            {(t.symbol || "?").slice(0, 3).toUpperCase()}
                          </span>
                        )}
                        <span className="font-semibold text-ink">{t.symbol}</span>
                        <span className="text-faint">
                          /{t.quoteSymbol ?? "SOL"}
                        </span>
                        <span className="max-w-[130px] truncate text-mute">
                          {t.name}
                        </span>
                        {t.boosts ? (
                          <Badge tone="warn" title="Paid DexScreener boosts">
                            ⚡{t.boosts}
                          </Badge>
                        ) : null}
                        {(t.ageHours ?? 999) < 1 ? (
                          <Badge tone="accent">new</Badge>
                        ) : null}
                      </Link>
                    </td>
                    <td className="text-right font-medium">{usd(t.priceUsd)}</td>
                    <td className="hidden text-right text-mute sm:table-cell">
                      {ageLabel(t.ageHours)}
                    </td>
                    <td className="hidden text-right lg:table-cell">
                      {count(txnsFor(t, frame))}
                    </td>
                    <td className="text-right">{compactUsd(volumeFor(t, frame))}</td>
                    <td className="hidden text-right xl:table-cell">
                      {count(t.traders24h)}
                    </td>
                    <td
                      className={cx(
                        "hidden text-right lg:table-cell",
                        pctColor(t.priceChange5m),
                      )}
                    >
                      {pct(t.priceChange5m)}
                    </td>
                    <td
                      className={cx(
                        "hidden text-right md:table-cell",
                        pctColor(t.priceChange1h),
                      )}
                    >
                      {pct(t.priceChange1h)}
                    </td>
                    <td
                      className={cx(
                        "hidden text-right lg:table-cell",
                        pctColor(t.priceChange6h),
                      )}
                    >
                      {pct(t.priceChange6h)}
                    </td>
                    <td className={cx("text-right", pctColor(t.priceChange24h))}>
                      {pct(t.priceChange24h)}
                    </td>
                    <td className="hidden text-right md:table-cell">
                      {compactUsd(t.liquidityUsd)}
                    </td>
                    <td className="hidden text-right sm:table-cell">
                      {compactUsd(t.marketCap ?? t.fdv)}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={13} className="py-10 text-center text-mute">
                      {feed === "searched"
                        ? "No searches recorded yet — search a token and it will appear here."
                        : activeFilterCount || category || quick
                          ? "No pairs match these filters."
                          : "No pairs returned. Try Refresh."}
                    </td>
                  </tr>
                ) : null}

                {loading && rows.length === 0
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={`sk-${i}`}>
                        <td colSpan={13}>
                          <div className="skeleton h-5 w-full" />
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>

          <AdSlot slot="scanner_inline" className="border-t border-edge p-2" />
        </div>

        {/* ── Right rail ── */}
        <aside className="space-y-3">
          <AdSlot slot="sidebar" />
          <div className="card p-3 text-2xs leading-relaxed text-mute">
            <p className="mb-1 text-xs font-semibold text-ink">How to read this</p>
            <p>
              Colour and ranking follow the timeframe you pick in the header. A
              token can be green on 5M and red on 24H — that is a bounce inside a
              downtrend, not a reversal.
            </p>
            <p className="mt-2">
              <b>Traders</b> is the 24h transaction count (activity proxy).
              <b> Boosted</b> means the team paid DexScreener for promotion — it
              is marketing spend, not a quality signal.
            </p>
          </div>
        </aside>
      </div>

      {/* ── Filters modal ── */}
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(EMPTY_FILTERS)}>
              Reset
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setFilters(draft);
                setFiltersOpen(false);
              }}
            >
              Apply filters
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Min liquidity (USD)">
            <TextInput
              inputMode="numeric"
              value={draft.minLiq}
              onChange={(e) => setDraft({ ...draft, minLiq: e.target.value })}
              placeholder="e.g. 20000"
            />
          </Field>
          <Field label="Max liquidity (USD)">
            <TextInput
              inputMode="numeric"
              value={draft.maxLiq}
              onChange={(e) => setDraft({ ...draft, maxLiq: e.target.value })}
            />
          </Field>
          <Field label="Min market cap (USD)">
            <TextInput
              inputMode="numeric"
              value={draft.minMcap}
              onChange={(e) => setDraft({ ...draft, minMcap: e.target.value })}
            />
          </Field>
          <Field label="Max market cap (USD)">
            <TextInput
              inputMode="numeric"
              value={draft.maxMcap}
              onChange={(e) => setDraft({ ...draft, maxMcap: e.target.value })}
            />
          </Field>
          <Field
            label={`Min volume in ${frame.toUpperCase()} (USD)`}
            hint="Applies to the timeframe selected in the header."
          >
            <TextInput
              inputMode="numeric"
              value={draft.minVol}
              onChange={(e) => setDraft({ ...draft, minVol: e.target.value })}
            />
          </Field>
          <Field label={`Min txns in ${frame.toUpperCase()}`}>
            <TextInput
              inputMode="numeric"
              value={draft.minTxns}
              onChange={(e) => setDraft({ ...draft, minTxns: e.target.value })}
            />
          </Field>
          <Field label="Min age (hours)">
            <TextInput
              inputMode="decimal"
              value={draft.minAgeH}
              onChange={(e) => setDraft({ ...draft, minAgeH: e.target.value })}
              placeholder="e.g. 24 to skip brand-new launches"
            />
          </Field>
          <Field label="Max age (hours)">
            <TextInput
              inputMode="decimal"
              value={draft.maxAgeH}
              onChange={(e) => setDraft({ ...draft, maxAgeH: e.target.value })}
              placeholder="e.g. 6 for fresh pairs only"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
