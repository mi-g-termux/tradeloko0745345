# MemePump - A-Z Rebuild Prompt (reusable for client projects)

Use this to spin up a fresh copy of this platform for a client. Upload this whole
project as the starting point, then paste the prompt below and replace every
`<PLACEHOLDER>` with the client's details. The AI should keep the existing
architecture and only re-skin + reconfigure.

---

## HOW TO USE

1. Zip and upload this entire project to the AI builder.
2. Copy the prompt in the next section.
3. Replace the placeholders:
   - `<PROJECT_NAME>` - e.g. "SolSniper"
   - `<TAGLINE>` - one line describing the product
   - `<PRIMARY_COLOR>` / `<ACCENT_COLOR>` - hex colors for the theme
   - `<LOGO_DESCRIPTION>` - what the favicon/logo should look like
   - `<FEE_WALLET>` - the client's SOL address for platform fees (optional)
4. Send. Then finish the deploy checklist at the bottom.

---

## THE PROMPT (copy everything below the line)

---

You are a senior full-stack engineer. I am uploading a working Next.js 14
(App Router) + TypeScript + Tailwind + Supabase project. It is a real-time Solana
memecoin trading and analytics tool (BullX/Photon/DexScreener style). Do NOT
rewrite it from scratch - keep the architecture, file layout, and data flow.
Re-brand and reconfigure it for my client, then extend it exactly as specified.

### Product
- Brand name: **<PROJECT_NAME>**
- Tagline: <TAGLINE>
- Everything must run on REAL data (no mock/placeholder data anywhere).

### Branding changes
- Replace every occurrence of the current brand name in the UI (nav header,
  `<title>`, PWA manifest `name`/`short_name`, welcome panel, email "From" name)
  with **<PROJECT_NAME>**. Do not leave any old brand text.
- No decorative emojis in the nav or headings.
- Theme: primary `<PRIMARY_COLOR>`, accent `<ACCENT_COLOR>`; keep the dark
  base. Update Tailwind theme tokens, not one-off styles.
- Favicon/logo: <LOGO_DESCRIPTION>. Put the image at `public/icon.png` (plus
  `public/icon-192.png` and `public/icon-512.png`) and wire it in
  `src/app/layout.tsx` metadata `icons` and `public/manifest.webmanifest`.

### Core features that must work (they already exist - verify + keep)
1. **Scanner** - live trending Solana tokens from DexScreener with Trending,
   Volume, Gainers, New, and Searched tabs; client-side filters (min liquidity,
   min market cap, min 24h volume); token logo with a symbol-initial fallback;
   dedupe majors/stables so the same token never repeats. Admin-pinned tokens
   ride at the top.
2. **Launches** - a live pump.fun new-mint websocket feed that ALSO backfills
   the most recent tokens on load (so coins a few minutes old show immediately),
   with market cap + dev-buy + live age.
3. **Token page** - price, chart, rug/safety score (mint/freeze authority,
   holder concentration, liquidity), top holders + estimated PnL, and a Buy
   panel (Jupiter).
4. **Signals** - technicals + patterns + safety + optional AI (Gemini) + optional
   X sentiment fused into a directional call with entry/invalidation/targets, plus
   a tracked hit-rate and auto-updating Telegram alerts.
5. **Whales** - track wallets (Helius); show each wallet's buys/sells, trade size
   in SOL, and the token's current price + market cap. Admin can add smart-money
   wallets that generate signals when they buy.
6. **Portfolio / Orders** - holdings + PnL; limit / TP / SL orders run by a keeper.
7. **Auth** - sign in with a Solana wallet (SIWS) or Telegram. First sign-in is
   the permanent owner; everyone else defaults to a normal user.
8. **Admin panel** - all feature toggles, API keys (Helius, Gemini, Telegram,
   RPC, SMTP), risk rails, pinned tokens, hidden trading fee, and member roles.
9. **Automation** - scheduled cron endpoints (scan, keeper, copytrade, outcomes,
   holders, signal-updates, price-alerts, whale-signals) secured by CRON_SECRET.

### New/extended work for this client
- Set the hidden trading fee destination to `<FEE_WALLET>` (admin can change it).
- <ANY_CLIENT_SPECIFIC_REQUESTS>

### Hard rules
- Real data only; never fabricate tokens, prices, or activity.
- All secrets stay server-side; never ship them to the browser.
- Every list/table must handle empty + error states gracefully.
- Keep TypeScript strict; no `any` that breaks the build.
- After changes, ensure `next build` passes.

### Deliverables
- The updated project, plus a short SETUP.md with env vars, the Supabase SQL to
  run, and the cron schedule.

---

## DEPLOY CHECKLIST (do this after the AI finishes)

1. **Supabase**: create a project, run `supabase/schema.sql` in the SQL editor.
2. **Env vars** (Vercel): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SESSION_SECRET`, `CRON_SECRET`. Optional: `SOLANA_RPC_URL` (real RPC to avoid
   429s), `NEXT_PUBLIC_APP_NAME`.
3. **Deploy** to Vercel (or push to GitHub main -> Vercel auto-build).
4. **Cron**: point cron-job.org (or GitHub Actions) at the `/api/cron/*` routes
   with header `Authorization: Bearer <CRON_SECRET>`. Base URL must have NO
   trailing slash (avoid `//api/...`).
5. **Admin**: sign in first (you become owner), then in the Admin panel turn on
   the features you want and paste the API keys (Helius, Gemini, Telegram, RPC).
6. **Favicon**: drop the client logo at `public/icon.png` (+ 192/512).


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
