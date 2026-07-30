"use client";
// DexScreener-style header: a horizontally scrolling strip of category chips
// with aggregate market caps, plus 24H VOLUME / 24H TXNS stat tiles.
//
// IMPORTANT: every number here is computed from the tokens actually loaded from
// DexScreener. Nothing is faked. Categories are keyword buckets over the loaded
// set, so "Dog $792M" means "the dog-themed tokens in this list total $792M",
// which is why each chip shows its token count on hover.
import { useMemo } from "react";
import type { TokenSummary } from "@/lib/types";
import { compactUsd, count } from "@/lib/format";
import { Chip, StatTile } from "./ui";

export interface Category {
  id: string;
  label: string;
  match: (t: TokenSummary) => boolean;
}

function kw(...words: string[]) {
  return (t: TokenSummary) => {
    const hay = `${t.symbol ?? ""} ${t.name ?? ""}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  };
}

/** Keyword "meta" buckets, mirroring how DexScreener groups narratives. */
export const CATEGORIES: Category[] = [
  { id: "dog", label: "Dog", match: kw("dog", "inu", "shib", "bonk", "wif", "floki", "doge") },
  { id: "cat", label: "Cat", match: kw("cat", "meow", "paw", "mog") },
  { id: "ai", label: "AI", match: kw("ai", "gpt", "agent", "bot", "neural") },
  { id: "pepe", label: "Frog / Pepe", match: kw("pepe", "frog", "peps") },
  { id: "brainrot", label: "Brainrot", match: kw("skibidi", "rizz", "sigma", "gyat", "brainrot") },
  { id: "politics", label: "Politics", match: kw("trump", "biden", "maga", "elon", "boden") },
  { id: "animal", label: "Other animals", match: kw("bird", "monkey", "ape", "bear", "bull", "goat", "hippo", "penguin") },
  { id: "food", label: "Food", match: kw("pizza", "burger", "taco", "banana", "coffee", "beer") },
];

export default function MarketStrip({
  tokens,
  activeCategory,
  onCategory,
}: {
  tokens: TokenSummary[];
  activeCategory: string | null;
  onCategory: (id: string | null) => void;
}) {
  const stats = useMemo(() => {
    let volume = 0;
    let txns = 0;
    let liquidity = 0;
    for (const t of tokens) {
      volume += t.volume24h ?? 0;
      txns += t.txns24h ?? (t.txns24hBuys ?? 0) + (t.txns24hSells ?? 0);
      liquidity += t.liquidityUsd ?? 0;
    }
    return { volume, txns, liquidity };
  }, [tokens]);

  const buckets = useMemo(
    () =>
      CATEGORIES.map((c) => {
        const members = tokens.filter(c.match);
        const mcap = members.reduce(
          (s, t) => s + ((t.marketCap ?? t.fdv) ?? 0),
          0,
        );
        return { ...c, n: members.length, mcap };
      })
        // Only show a narrative that actually exists in the current list.
        .filter((c) => c.n > 0)
        .sort((a, b) => b.mcap - a.mcap),
    [tokens],
  );

  return (
    <div className="space-y-2">
      {/* ── Category / meta ticker ── */}
      {buckets.length > 0 ? (
        <div className="scroll-x flex items-center gap-2 pb-1">
          {/* There used to be a bare "Metas" caption sitting inside this row. It
              looked exactly like the chips beside it but was not clickable, so
              it read as a broken button. The row is self-explanatory without a
              label, so the label is gone rather than restyled. */}
          <Chip active={activeCategory === null} onClick={() => onCategory(null)}>
            All
          </Chip>
          {buckets.map((b) => (
            <Chip
              key={b.id}
              active={activeCategory === b.id}
              onClick={() => onCategory(activeCategory === b.id ? null : b.id)}
              title={`${b.n} tokens in the current list`}
            >
              {b.label}
              <span className="text-faint">{compactUsd(b.mcap)}</span>
            </Chip>
          ))}
        </div>
      ) : null}

      {/* ── Aggregate stat tiles ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="24H Volume"
          value={compactUsd(stats.volume)}
          sub={`across ${tokens.length} pairs`}
        />
        <StatTile
          label="24H Txns"
          value={count(stats.txns)}
          sub="buys + sells"
        />
        <StatTile label="Total liquidity" value={compactUsd(stats.liquidity)} />
        <StatTile
          label="Pairs tracked"
          value={count(tokens.length)}
          sub="live market data"
        />
      </div>
    </div>
  );
}
