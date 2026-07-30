# REBUILD-PROMPT V2

This supersedes `REBUILD-PROMPT.md` wherever they disagree. V1 describes the
original feature set; V2 describes the accuracy rebuild, the DexScreener-style
UI, admin branding, the ads system, and the cron/scheduling layer.
Operational setup (env vars, SQL migration, cron-job.org schedule) lives in
`SETUP.md`.

---

## 1. Signal accuracy (why v1 was wrong, and what v2 does)

Root causes found in v1:

| Bug | Effect |
| --- | --- |
| EMA started at `values[0]` with no SMA seed and no minimum length | A token with 4 candles still produced an `ema50`, so the "EMA trend" was fiction |
| RSI averaged the last 14 diffs instead of Wilder smoothing | Wrong values, over-reactive |
| MACD inherited the unseeded EMA and only required 35 closes | Histogram sign was unreliable |
| `detectPatterns` ran from 20 candles | Two-swing "Double Top" noise carried +/-18 score points |
| `swingHighs/Lows` compared each candle against itself (`>=` over the window incl. `i`) | Extrema were missed |
| `confidence = |score|` | Never normalised by how much evidence existed -> "85% confident" from 3 candles |
| Candles were always requested as `hour/1` | A 40-minute-old memecoin returned 1-3 bars |

V2 implementation:

- `src/lib/analysis/technical.ts`
  - `emaSeries()` is SMA-seeded and returns `null` before `period` bars.
  - Wilder `rsi()` and `atr()`.
  - `macd()` requires 26 + 9 bars.
  - `TECHNICAL_LIMITS = { MIN_PATTERN_CANDLES: 30, MIN_SIGNAL_CANDLES: 20, GOOD_SIGNAL_CANDLES: 60 }`.
  - `computeIndicators()` also returns `candleCount` and `atrPct`.
  - Trend falls back to EMA 9 vs 21 when there are fewer than 50 candles, and
    reports `sideways` rather than guessing below 21.
- `src/lib/data/candles.ts`
  - `CANDLE_SPECS` (`m1, m5, m15, h1, h4, d1`), a 45s in-process cache,
    `specForAge()` and `getAdaptiveCandles()` which walks a timeframe ladder
    until it has enough bars, returning `{ candles, spec, attempts }`.
- `src/lib/analysis/signal.ts`
  - Every input is a `SignalFactor { label, score (-100..100), weight, detail }`
    and the composite is a WEIGHTED AVERAGE, so missing data lowers confidence
    instead of counting as neutral agreement.
  - Weights: EMA trend 22 (13 without EMA50), MACD 14, RSI 12, 5m 8, 1h 14,
    6h 10, 24h 8, order flow 14 (requires 30+ txns), liquidity 6-10,
    turnover 8, each pattern 16, safety 16 (26 when `danger`),
    social `6 + 10*buzz`, AI 18.
  - `qualityMultiplier`: high 1.0, medium 0.85, low 0.55, none 0.35.
  - Confidence is additionally cut 40% when total evidence weight < 40.
  - **Honesty gate**: below `MIN_SIGNAL_CANDLES` the direction is forced to
    `neutral` and confidence capped at 25. A signal that says "not enough data
    yet" is worth more than a fabricated one.
  - Hard safety cap: bullish score x0.3 when safety < 35.
  - Targets/stops are derived from ATR, not a flat 2x/3x/5x.
  - Returns `quality: SignalQuality` and `factors: SignalFactor[]`, both
    rendered in `SignalPanel` ("Evidence quality" + "Why this score?").

## 2. Scheduling / cron (why signals were irregular)

- `vercel.json` had **no crons at all**.
- Seven of nine routes did `if (!secret) return true` -> publicly triggerable
  when `CRON_SECRET` was unset, while two returned `false`. Inconsistent.
- `/api/cron/scan` silently skips unless `autoScanEnabled`, indistinguishable
  from a broken schedule.
- Nothing was recorded, so a dead cron-job.org entry looked healthy.

V2: `src/lib/cron/runner.ts`

- `CRON_JOBS` registry: job id, path, cadence, label, description.
- `isCronAuthorized()` accepts `Authorization: Bearer <CRON_SECRET>`,
  `x-cron-secret`, or `?key=`, and **fails closed** when the secret is unset.
- `runCronJob(job, req, handler)` wraps all nine routes: auth, timing,
  heartbeat row in `cron_runs`, uniform JSON envelope
  `{ ok, job, status, skipped?, reason?, durationMs, result, ranAt }`,
  401 when unauthorised and 500 on throw so cron-job.org marks FAILED.
- `getCronStatus()` -> `CronRunInfo[]` with `runs24h`, `errors24h`,
  `lastError`, and `overdue` (no run within 2.5x the expected cadence).
- `GET /api/admin/cron` returns `{ cronSecretConfigured, baseUrl, jobs,
  schedule }`; the admin Automation tab polls it every 60s and renders a health
  table plus copy-paste cron-job.org cards.
- `vercel.json` keeps hourly backup crons (Hobby plans only honour coarse
  schedules); cron-job.org remains the primary scheduler. Duplicate triggers
  are harmless — the jobs are idempotent and de-duplicated.

## 3. Design system

- `src/app/globals.css`: CSS variables `--c-base/panel/panel-2/edge/edge-2/ink/
  mute/faint/accent/accent-soft/up/down/warn`, `--nav-h`, thin scrollbars,
  visible focus rings, and component classes `.card`, `.dtable`, `.th-sort`,
  `.scroll-x`, `.skeleton`.
- `tailwind.config.ts`: every colour maps to a CSS variable so the admin accent
  colour overrides the palette at runtime; adds `text-2xs`, `rounded-card`,
  `shadow-pop`, `shadow-glow`, `animate-flashUp/flashDown/shimmer`.
- `src/components/ui.tsx`: `cx`, `Button`, `Chip`, `SegmentedControl`,
  `Switch` (prints the literal word ON / OFF), `Badge`, `StatusBadge`,
  `StatTile`, `Field`, `inputClass`, `TextInput`, `Modal`, `Tabs`, `SortTh`,
  `SplitBar`.

## 4. Scanner (screenshot 1 parity)

`src/app/page.tsx` + `src/components/MarketStrip.tsx`:

- "Metas" chip ticker with keyword buckets (dog, cat, AI, pepe, brainrot,
  politics, animal, food) sized by aggregate market cap, plus 24H Volume,
  24H Txns, Total liquidity and Pairs tracked tiles — all computed from the
  loaded rows, never hardcoded.
- Feed segmented control (Trending / Top / Gainers / New pairs) and timeframe
  segmented control (5M / 1H / 6H / 24H) that re-points the change, volume and
  txns columns.
- 13-column sortable dense table: rank badge, token icon + symbol +
  `/{quoteSymbol}` + name, boost and "new" badges, MCAP, PRICE, AGE, TXNS,
  VOLUME, TRADERS, 5M, 1H, 6H, 24H, LIQUIDITY.
- Quick chips (boosted / fresh / gainers / losers / deep liquidity), a Filters
  modal with 8 numeric bounds, live 30s auto-refresh toggle, skeleton loading
  rows and contextual empty states.

## 5. Token page (screenshot 2 parity)

`src/app/token/[address]/page.tsx` + `src/components/PriceChart.tsx`:

- Native SVG candlestick chart (no new dependency) fed by
  `/api/candles/:address`, with 1m / 5m / 15m / 1h / 4h / 1D frames,
  Price/MCap toggle, log-scale toggle, hover crosshair showing O/H/L/C/Vol and
  a volume histogram.
- Header: icon, symbol `/quote`, name, boost + DEX badges, copy-CA,
  Website / Twitter / Telegram, Watchlist toggle, Alert button.
- Tabs: Signal (full `SignalPanel` incl. evidence quality), Top traders,
  Safety factors, Trade.
- Right rail: Price USD, Age, Liquidity / FDV / Mkt Cap, 5M/1H/6H/24H change
  row, Txns / Volume / Traders, buys-vs-sells split bars (24h and 5m),
  volume per window, Jupiter / DexScreener / Solscan links.
- **Deliberate omission**: the per-trade transactions table from the screenshot
  is NOT faked. DexScreener's free API does not return individual trades, and
  `traders24h` is labelled as a transaction-count proxy rather than a wallet
  count.

## 6. Branding (admin panel -> navbar + browser tab)

- `admin_config` columns `brand_name`, `logo_url`, `favicon_url`,
  `logo_height`, `show_brand_name`, `accent_color`.
- `src/lib/branding.ts`: `safeImageUrl()` (http/https/data-image/site-relative
  only — no `javascript:`), `safeHexColor()`, logo height clamped 14-64px.
- `GET /api/branding` is public so the logo renders before sign-in.
- `Nav.tsx` renders the logo top-left exactly like DexScreener, with a lettered
  fallback tile when the URL is missing or fails to load.
- `layout.tsx` uses `generateMetadata()` so the tab title and favicon follow the
  admin settings (favicon -> logo -> bundled `/icon.svg`).

## 7. Ads

- Five slots: `top_banner`, `sidebar`, `scanner_inline`, `token_page`, `footer`.
- `site_ads` table + `bump_ad_counter()` RPC; `src/lib/ads.ts` does weighted
  rotation and records impressions/clicks.
- Image+link creatives or raw ad-network HTML (AdSense / Coinzilla / A-ADS).
  `AdSlot.tsx` re-creates `<script>` nodes so network snippets actually execute.
- `GET /api/ads`, `POST /api/ads/click`, admin CRUD at `/api/admin/ads`, master
  switch `ads_enabled`. Empty or disabled slots render nothing at all.

## 8. Admin panel

`src/app/admin/page.tsx` — rebuilt from one flat 428-line column into 8 tabs
(Branding, Automation, Ads, Signals, Alerts, Providers, Trading, Members) with:

- `Switch` controls that show the literal word **ON** / **OFF** plus a coloured
  track, and a `needs <provider> key` badge when a toggle cannot work yet.
- Dirty-state tracking with a sticky save bar ("N unsaved changes",
  Discard / Save).
- Branding tab with a live navbar preview and favicon preview.
- Automation tab with cron health, latest errors, a `CRON_SECRET` warning, and
  copy-paste cron-job.org setup cards.
- Ads tab with per-slot cards, a creatives table showing CTR, and a create/edit
  modal.

## 9. Database (see `SETUP.md` step 1)

`supabase/schema.sql` is idempotent; v2 appends 7 `admin_config` columns,
`site_ads` + index, `bump_ad_counter()`, `cron_runs` + index, and
`prune_cron_runs()`.

## 10. Telegram buy button (v2.1)

Bug: `tokenButtons()` built `⚡ Trade` from `appBaseUrl()`, which falls back to
`http://localhost:3000` when no app URL env var is set — a rendered button that
resolves to the reader's own machine. It also linked `pump.fun/<mint>` for every
token (404 for non-pump.fun tokens) and `sendTo()` swallowed Telegram's error
body, so `BUTTON_URL_INVALID` was invisible.

Fix:

- `src/lib/config.ts` → `publicBaseUrl()`: like `appBaseUrl()` but returns `""`
  for localhost / `127.0.0.1` / private LAN / `.local` / TLD-less hosts. Use it
  for anything a third party clicks.
- `src/lib/notify/buyLinks.ts` → `isTelegramSafeUrl()`, `buildBuyLinks()`,
  `primaryBuyLink()`, plus per-route builders (`jupiterBuyUrl`, `bonkbotUrl`,
  `trojanUrl`, `gmgnUrl`, `customUrl`, `dexscreenerUrl`) and the `BUY_ROUTES`
  catalogue. Invalid URLs are dropped, never emitted.
- Routes: `jupiter` (default, `https://jup.ag/swap/SOL-<mint>`), `bonkbot`
  (`?start=ref_<code>_ca_<mint>`), `trojan` (`?start=r-<ref>-<mint>`), `gmgn`,
  `custom` (`{ca}` / `{ref}` template), `app`.
- A web buy link is force-appended whenever the chosen route is a Telegram bot,
  because bot deeplinks are documented as non-functional on Telegram Desktop.
- `signalText()` embeds the primary buy link as an HTML anchor, so the alert is
  actionable even without an inline keyboard.
- `sendTo()` logs Telegram's `description` and retries once without
  `reply_markup` so one bad button cannot lose the signal.
- `buyButtonPreview(sampleMint)` exposes the resolved URLs to the admin panel.
- New `admin_config` columns `tg_buy_route`, `tg_buy_ref`, `tg_buy_template`
  (added to `PLAIN_KEYS`, `AdminConfig`, DEFAULTS, and the Alerts tab UI with
  inline desktop/app-URL warnings).
- Web UI: stale `pump.fun/<mint>` links updated to the canonical
  `pump.fun/coin/<mint>` in `token/[address]/page.tsx` and `BuyPanel.tsx`.
  These stay pump.fun on purpose — they are the pre-graduation paths.


---

## Analysis engine specification (v16) - REQUIRED

Any rebuild of this project MUST implement the following. These are not
optional refinements; without them the signal engine produces confident-looking
noise, which is the exact failure this specification exists to prevent.

### Mandatory 24-hour scan before every signal

Implement `src/lib/analysis/window24h.ts`:

- Reconstruct the **entire trailing 24 hours** at 5-minute resolution (up to 288
  bars) from GeckoTerminal OHLCV before any signal is emitted.
- Fall back to 1-minute bars when fewer than 48 five-minute bars exist, so a
  young token still yields usable history.
- Compute: 24h high/low/open/close, position of price inside the range (0-1),
  session VWAP, price vs VWAP, total volume, volume trend (second half / first
  half), green-bar share, volume-weighted buy/sell imbalance, largest single-bar
  move, and a compression flag.
- Expose `sessionBias()` returning a -1..1 vote. It must be **contrarian at the
  extremes**: pinned at the 24h high subtracts, sitting on 24h support adds, and
  a dried-up volume trend multiplies the whole reading down.
- The fixed 24h window is what makes signals reproducible and regularly spaced.
  Do NOT analyse "whatever candles are cached".

### Market structure - `src/lib/analysis/structure.ts`

- `zigzag(candles, depthPct)` - commit a pivot only after price retraces
  `depthPct` from the running extreme. Include the in-progress leg.
- `autoDepth(candles)` - derive the depth from average per-bar movement
  (~4 average bars), clamped to 1.5%-15%. Never hardcode a depth.
- `marketStructure()` - label swings HH/HL/LH/LL, derive bias
  (bullish/bearish/range), and detect **BOS** (break in the trend direction) and
  **CHoCH** (first break against the trend). Breaks require a **close** beyond
  the level - a wick through is a liquidity sweep, the opposite of a break.
- `keyLevels()` - cluster pivots within a tolerance into levels scored by touch
  count, classified support/resistance by position relative to price (so broken
  resistance correctly flips to support).
- `liquidityZones()` - equal highs/lows where stops rest.
- `fibRetracement()` - 23.6/38.2/50/61.8/78.6 of the last completed leg, and
  whether price is inside the 38.2-78.6 golden pocket.
- `superTrend(candles, 10, 3)` - ATR bands that only ever tighten in the trend
  direction, reporting direction, band value, bars since flip, and a `flipped`
  flag for a fresh signal.

### Chart patterns - `src/lib/analysis/chartPatterns.ts`

Detect from ZigZag pivots, never from raw closes: Head & Shoulders, Inverse Head
& Shoulders, Ascending/Descending/Symmetrical Triangle, Rising Wedge (bearish),
Falling Wedge (bullish), Bull Flag, Bear Flag, Double/Triple Top, Double/Triple
Bottom, Cup & Handle, Rectangle range.

Rules:
- Every pattern MUST report its trigger level, measured target (projected from
  the pattern's own height) and invalidation. If all three cannot be produced,
  do not emit the pattern.
- Flags require a shallow consolidation after a >12% impulse, and check that
  volume dried up in the flag.
- Rising wedge is BEARISH and falling wedge is BULLISH - opposite to their
  slope. These are the two most commonly inverted patterns.
- Head & Shoulders must suppress a Double/Triple Top built from the same
  shoulders. Never count one swing twice.
- Sort by confidence and cap the list at 5.

### Candlestick formations - `src/lib/analysis/candlesticks.ts`

Implement: Hammer, Hanging Man, Shooting Star, Inverted Hammer, Marubozu,
Spinning Top, Doji, Dragonfly Doji, Gravestone Doji, Long-legged Doji, Bullish
and Bearish Engulfing, Bullish and Bearish Harami, Piercing Line, Dark Cloud
Cover, Tweezer Top, Tweezer Bottom, Morning Star, Evening Star, Three White
Soldiers, Three Black Crows, Three Inside Up, Three Inside Down.

Non-negotiable rules:
1. **Context gating.** A hammer requires a preceding downtrend; the same shape
   after a rally is a hanging man with the opposite meaning. Discard formations
   that lack the correct prior trend - do not just lower their confidence.
2. **Relative sizing.** Measure every threshold against the average real body of
   the prior ~14 bars, never against absolute price.
3. **One formation per bar.** Check three-bar patterns before the two-bar
   patterns they contain, so a Morning Star is not downgraded to a Harami.
4. **Recency decay.** Multiply confidence down as `barsAgo` grows.
5. Aggregate to a single `candlestickBias()` vote so a cluster of doji cannot
   outweigh the actual trend.

### Weighted scoring (`src/lib/analysis/signal.ts`)

Every input casts a weighted -1..1 vote; the score is the weighted average of
the evidence that exists. Weights: market structure 20, EMA stack 22, AI council
18, chart pattern 16 each, SuperTrend 16 (fresh flip) / 12, 24h session up to 16,
safety 16-26, BOS 14, MACD 14, order flow 14, 1h change 14, candlesticks up to
14, RSI 12, CHoCH 12, Fibonacci 8, key-level proximity 8.

### Entries, stops and targets

- Build the **stop before the target**.
- Stop goes just below the nearest real level (last swing low, multi-touch
  support, 24h low, session VWAP). When a structural stop and a 2-ATR stop both
  exist, use the tighter one. Never use a bare percentage unless no level exists.
- T1 is the next genuine level overhead; only then project 2-ATR / 4-ATR.
- Compute and state **risk/reward to T1**, and warn explicitly when it is under
  1:1.
- Warn against chasing when price is in the top 15% of the 24h range.

### Honesty gates - do not remove these

- Under 20 candles: force `neutral` and state the reason. Never issue a
  directional call from price change alone.
- Scale confidence by data quality and again when few independent inputs exist.
- Report a missing 24h session and reduce confidence for it.
- Hard-cap bullish scores when the safety score is low.
- With the AI council on, model disagreement must LOWER confidence and the split
  must be stated on the signal.

### Live chart

`src/components/PriceChart.tsx` (rendered on `/token/[address]`, the analysis
page) must poll per timeframe - 1m:10s, 5m:15s, 15m:20s, 1h:30s, 4h:60s, 1d:60s
- using `cache: "no-store"`, refetch on tab focus, pause in background tabs,
never flicker on refresh, never wipe drawn candles on a failed refresh, and show
a pulsing LIVE badge with the last update time.


---

## Complete pattern inventory (v17)

The engine recognises **64 candlestick formations, 19 chart patterns and 7
institutional liquidity setups**. Everything below is implemented with explicit
geometry rules, not curve-fitting.

### Candlestick formations - `candlesticks.ts` + `candlesticksAdvanced.ts`

**Single bar:** Hammer, Hanging Man, Shooting Star, Inverted Hammer, Bullish and
Bearish Marubozu, Spinning Top, Doji, Dragonfly Doji, Gravestone Doji,
Long-legged Doji, High Wave, Bullish and Bearish Belt Hold.

**Two bar:** Bullish and Bearish Engulfing, Bullish and Bearish Harami, Piercing
Line, Dark Cloud Cover, Tweezer Top, Tweezer Bottom, On Neck, In Neck, Matching
Low, Homing Pigeon, Bullish and Bearish Meeting Lines, Bullish and Bearish
Separating Lines, Last Engulfing Top, Last Engulfing Bottom, Bullish and Bearish
Kicking, Rising Window, Falling Window.

**Three bar:** Morning Star, Evening Star, Three White Soldiers, Three Black
Crows, Identical Three Crows, Three Inside Up, Three Inside Down, Three Outside
Up, Three Outside Down, Bullish and Bearish Tri-Star, Bullish and Bearish
Abandoned Baby, Upside Tasuki Gap, Downside Tasuki Gap, Upside Gap Two Crows,
Two Crows, Two Black Gapping, Advance Block, Deliberation, Three Stars in the
South, Unique Three River Bottom, Stick Sandwich, Side-by-Side White Lines.

**Four and five bar:** Bullish and Bearish Three Line Strike, Rising Three
Methods, Falling Three Methods, Mat Hold, Ladder Bottom.

### Chart patterns - `chartPatterns.ts` + `technical.ts`

Head & Shoulders, Inverse Head & Shoulders, Ascending Triangle, Descending
Triangle, Symmetrical Triangle, Rising Wedge, Falling Wedge, Bull Flag, Bear
Flag, Bull Pennant, Bear Pennant, Double Top, Double Bottom, Triple Top, Triple
Bottom, Rounding Top, Rounding Bottom, Cup & Handle, Rectangle Range, Ascending
Channel, Descending Channel, Resistance Breakout, Support Breakdown.

### Institutional liquidity setups - `institutional.ts`

This is the Quasimodo / smart-money layer. The unifying mechanic is that large
orders cannot fill where there are no counterparties, so price is repeatedly
driven into the obvious places retail stops rest and then reverses.

| Setup | What it means |
| --- | --- |
| **Quasimodo (QM)** | A higher high that failed and then broke the prior low. The high was a liquidity grab; the left shoulder (QML) becomes the entry |
| **QM Quick / Late Retest** | Price is back at the QML now - the actual trigger. Quick (within 6 bars) scores higher than late |
| **Ignored QM** | Price closed straight through the level. Deliberately **flips the vote to the opposite side** - an ignored QM is a continuation signal, not a reason to keep fading |
| **SR Flip** | Broken resistance retested as support (or the reverse). Trapped traders exiting at breakeven is what defends the level |
| **Stop hunt** | A wick through a prior extreme that closes back inside. The highest-quality reversal tell in the family |
| **Compression** | Ranges contracting into a level. Direction unknown, but the expansion that follows is violent |
| **Three Drive** | Three pushes each smaller than the last - exhaustion, not strength |

These cast one aggregated vote weighted up to **18**, just below raw market
structure. A swept level is strong evidence, but it explains *why* price moved
rather than the direction it is currently moving, so it does not override trend.

### SuperTrend + ZigZag

Both are implemented in `structure.ts` and used together as the trend filter: a
ZigZag pivot confirms the swing, SuperTrend confirms the regime, and a fresh
SuperTrend flip within two bars is treated as the actionable event.

### Design rules enforced across all three layers

1. **Context is required.** A hammer is only a hammer after a decline. Wrong
   context means the formation is discarded, not down-weighted.
2. **Size is relative.** Thresholds are measured against the token's own average
   body, so identical code works on a 0.5%/bar and a 40%/bar token.
3. **One formation per bar.** Longest formations are checked first, so a Morning
   Star is never double-counted as a Doji.
4. **A break requires a CLOSE** beyond the level. A wick through and back is a
   liquidity sweep - the opposite of a break.
5. **Recency decay.** Older formations lose weight automatically.
6. **No target, no signal.** A pattern that cannot produce a measured target and
   an invalidation level is not emitted, because it is not tradeable.


## Paid token boosts (your own promotion product)

Token teams pay **you** to rank at the top of your Trending feed. Nothing about
this depends on a third party.

**Turn it on:** Admin panel -> **Token boosts**.
1. Set a **boost payout wallet** (a SOL address you control). Boosts stay off
   until this is set - taking money with no destination would lose it.
2. Price the three packages (Starter / Growth / Headline). You choose the SOL
   price and how many hours each boost runs. **Set a price to 0 to take that
   package off sale** - it is never given away free.
3. Switch **Boosts are on sale** on.
4. Add the 11th cron-job.org entry, `/api/cron/boost-expire`, hourly. Ranking
   already ignores expired boosts, so this is bookkeeping.

**How a buyer pays (both paths are automatic):**
- **From their in-app wallet** - one click. The server signs the transfer with
  that buyer's own custodial key, so the SOL leaves *their* balance. The boost
  activates immediately.
- **From any external wallet** - they send the exact amount to the payout
  address and paste the transaction signature. The server fetches the confirmed
  transaction and requires that the payout account's balance actually increased
  by at least the package price before activating. A signature on its own proves
  nothing, so it is always checked against the chain. One signature can never
  fund two boosts (enforced by a unique index).

Orders live in the `token_boosts` table and start as `pending`. Only a verified
payment flips them to `active`, and expiry is measured from the moment payment
cleared - a buyer who pays late still gets the full duration.

Boosted tokens are surfaced in Trending even when they are nowhere near the
organic volume leaders (that is what was paid for) and always carry a visible
**Boosted** badge, so traders can tell paid placement from organic ranking.

## Buying with the in-app wallet (no browser extension)

The Buy panel on a token page now defaults to **My wallet**: the trade is paid
from the balance in the wallet the user created on this site, signed server-side
with that user's own custodial key. No Phantom, and never the platform's wallet.

A trade is refused *before* any transaction is sent when:
- the user is not signed in, or has no in-app wallet yet;
- the balance is **0 SOL**;
- the balance cannot cover the amount plus about 0.003 SOL of network fees.

Each case shows a plain reason and a link to deposit, instead of firing a
transaction that is guaranteed to fail. The same balance check runs again
server-side, so the UI is a courtesy and not the security boundary.

**Phantom** is still available as an explicit opt-in tab for people who prefer
to keep custody. It is no longer the only way to trade.

## Database change for boosts

Re-run `supabase/schema.sql` in the Supabase SQL editor. It is idempotent. It
adds the `token_boosts` table (24 tables total), the boost pricing columns on
`admin_config`, and a unique index on `wallet_transactions (owner_id, signature)`
that makes overlapping history syncs safe.
