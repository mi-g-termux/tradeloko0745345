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
