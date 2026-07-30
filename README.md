# MemePump

A real-time Solana memecoin intelligence + trading tool (BullX / Photon style),
built on **Next.js 14 + Supabase + Jupiter + on-chain data**. Everything runs on
real data; nothing is mocked.

> **Risk**: Memecoins are extremely high risk and most go to zero. Signals are
> probabilities on real data, not predictions of the future. Only ever risk what
> you can afford to lose. Automated buying is off by default.

---

## UI / theme

- **Dark trading-terminal theme** (near-black `#0a0c10` base, `#0f1117` panels,
  `#1a1f2e` borders) with emerald = positive, red = danger/loss, amber = warning,
  indigo = primary actions.
- **All icons are [lucide-react](https://lucide.dev)** - there are no emojis
  anywhere in the UI. The brand mark, nav, badges, safety checks, PnL arrows and
  status messages all use clean line icons.
- Lightweight: Tailwind utilities only, no heavy UI kit. Sticky blurred nav,
  rounded panels, dense scannable data tables.

---

## Answers to common questions

### Is there a token search?
Yes. The scanner bar (home page) searches **any Solana token by name, symbol or
mint address** via DexScreener. Clear the search to return to trending.

### Can I see a token's biggest holders?
Yes. Every token page has a **Top holders** panel: the largest on-chain accounts,
their owner wallet, **share of supply**, and current **USD value**. A wallet
holding a large % of supply is flagged (amber) as a rug risk.

### Can I see how much profit each holder made?
Yes - click **PnL** on any holder row. It estimates that wallet's realized +
unrealized profit/loss (in SOL) for this specific token from its recent swap
history (via Helius). It is a best-effort estimate (last ~100 swaps, ignores fees
and complex routing) and requires a Helius API key.

### Trending tokens?
Yes - the scanner ranks trending tokens by **Volume**, **Gainers**, or **New**,
auto-refreshing every 30s. New launches (incl. a live pump.fun websocket feed)
are on the **Launches** page.

---

## Data persistence & access control

- **All user/app data is in Supabase (Postgres)** - accounts, roles, watchlists,
  tracked wallets, orders, signals + outcomes, holder history, admin settings.
  Nothing is wiped on logout/refresh/device change.
- **Sessions** = a server-signed `httpOnly` cookie (7-day expiry). `localStorage`
  is used for exactly one cosmetic thing: remembering the welcome panel was
  dismissed.
- **First person to sign in becomes the permanent `owner`.** After an owner
  exists, new sign-ups are plain viewers, so the admin never changes when others
  register. Optional `BOOTSTRAP_ADMIN_WALLET` pins ownership to one wallet.
- Admin routes (`/api/admin/*`) are enforced **server-side** (403 for
  non-admins); hiding the nav link is just UX. Roles: viewer < trader < admin <
  owner, managed in **Admin -> Members & roles**.

---

## Feature list

**Core:** live scanner + token search, token pages, rug/safety score, **top
holders + per-wallet PnL**, signal engine, 1-click Jupiter buy, wallet/Telegram
login.

**The 10 upgrades:** new-launch radar (+ live pump.fun feed), copy-trade, signal
outcome tracking (real hit-rate), portfolio & PnL, personal Telegram alerts,
deeper safety + holder-trend snapshots, limit/TP/SL keeper, multi-admin roles,
rate-limiting & caching, installable mobile PWA. Onboarding welcome/features
screen shows every capability with Live / Needs setup / Off badges.

**Email notifications (new):** SMTP-powered emails on every executed trade
(buys, and sells with profit-vs-loss + entry position), plus user-defined
**price-condition alerts** (e.g. up 2x / down 50%) with per-user email, on/off
toggles, and one-shot or repeat firing. SMTP is configured in the Admin panel;
each user sets their own email and toggles on the Account page. Everything is
stored in Supabase.

---

## Environment variables

Required for core:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SESSION_SECRET=            # long random string
```
Recommended / optional:
```
SOLANA_RPC_URL=           # paid RPC (Helius/Triton/QuickNode); public RPC is rate-limited
HELIUS_API_KEY=           # whales, holders, holder PnL (free tier works)
GEMINI_API_KEY=           # optional AI analysis (free at aistudio.google.com)
X_BEARER_TOKEN=           # optional X/Twitter social feed
TELEGRAM_BOT_TOKEN=       # global alerts (from @BotFather)
TELEGRAM_CHAT_ID=         # global alert destination
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=  # for the Telegram login widget
BOOTSTRAP_ADMIN_WALLET=   # optional: pin ownership to one wallet
CRON_SECRET=              # secures the cron endpoints (set same value in Vercel)
AUTO_BUY_SIGNER_KEY=      # base58 secret key of a DEDICATED hot wallet (auto-buy/copy/keeper)

# Email notifications (SMTP) - or set these in the Admin panel instead:
SMTP_HOST=                # e.g. smtp.gmail.com / smtp.resend.com / mail.yourhost.com
SMTP_PORT=587             # 587 STARTTLS (default) or 465 implicit TLS
SMTP_USER=                # SMTP login
SMTP_PASS=                # app password / API key
SMTP_FROM=                # "MemePump" <alerts@yourdomain.com>
SMTP_SECURE=false         # true only for port 465
NEXT_PUBLIC_APP_URL=      # public URL of your deploy (links inside emails)
NEXT_PUBLIC_APP_NAME=MemePump
```
Most keys can also be set at runtime in the **Admin panel** (stored in
`admin_config`), which takes precedence over env vars.

---

## Setup & deploy

1. **Supabase**: create a project, run `supabase/schema.sql` in the SQL editor
   (idempotent).
2. **Local**: `npm install` then `npm run dev`.
3. **First login = owner**: open the site, connect wallet (or Telegram) and sign.
   Open **Admin** to configure keys/toggles.
4. **Vercel**: import the repo, add env vars, deploy. Then set `CRON_SECRET` and
   schedule the nine `/api/cron/*` URLs on **cron-job.org** (copy-paste cards in
   Admin -> Automation). `vercel.json` has no `crons` array on purpose: Hobby
   allows only one run per day and rejects anything more frequent at deploy time.
5. **Backend note**: this is a single Next.js app - frontend + API run together
   on Vercel; Supabase is the database/backend. There is no separate backend
   server to deploy. If self-hosting (Render/cPanel), run `npm run build && npm
   start`, set the env vars, and schedule the `/api/cron/*` URLs with
   `Authorization: Bearer <CRON_SECRET>`.

### Email notifications setup
1. Pick any SMTP provider (Gmail app password, Resend, SendGrid, Mailgun,
   Postmark, Zoho, or your cPanel mailbox).
2. In **Admin -> Email notifications (SMTP)**, enter host, port, username,
   password, and the From address, then **Save**.
3. Click **Send test** to verify (the test bypasses the on/off toggle). Once
   the test email lands, switch **Email notifications** on.
4. Each user opens **Account**, adds their email, and toggles buy/sell and
   price alerts. Trade emails and price alerts are then delivered automatically.

### Deploy on Vercel (recommended)
- Import the repo, add all env vars, deploy. Set `CRON_SECRET`, then drive every
  cadence from cron-job.org (scan 15m, signal-updates 15m, price-alerts 5m,
  keeper 5m, whale-signals 10m, copytrade 10m, user-autotrade 15m, outcomes 30m,
  holders 60m). Vercel Hobby crons cannot do sub-daily schedules.
- `NEXT_PUBLIC_APP_URL` is auto-detected from `VERCEL_URL`.

### Deploy on Render
- New **Web Service** from the repo. Build: `npm install && npm run build`.
  Start: `npm start`. Add all env vars and set `NEXT_PUBLIC_APP_URL` to your
  Render URL.
- The web service has no built-in scheduler, so add Render **Cron Jobs** (or
  cron-job.org / GitHub Actions) that GET each `/api/cron/*` URL with header
  `Authorization: Bearer <CRON_SECRET>` on the schedules above - including
  `/api/cron/price-alerts` every ~2 minutes.

### Deploy on cPanel (Node.js app)
- Upload the project and create a **Setup Node.js App** (Node 18+). Run
  `npm install` then `npm run build`, and start with `npm start`. Add all env
  vars in the app UI, including `NEXT_PUBLIC_APP_URL` = your domain.
- Use cPanel **Cron Jobs** to curl each `/api/cron/*` endpoint with the bearer
  header on the schedules above, e.g. every 2 minutes:
  `curl -s -H "Authorization: Bearer $CRON_SECRET" https://yourdomain.com/api/cron/price-alerts`
- cPanel mailboxes work well as the SMTP provider (host `mail.yourdomain.com`,
  port 465 secure, or 587).

---

## Project structure

```
src/lib/            config, http, supabase, cache, types, adminConfig, features
  auth/             session (roles), users (first-user owner), siws, telegram
  data/             dexscreener, candles, twitter, whales, safety, launches,
                    portfolio, holderTrend
  solana/           rpc, holders (top holders + PnL), jupiter
  analysis/         technical, ai, signal, scanner, outcomes, copytrade
  trade/            execute (buy/sell rails), limitOrders (keeper)
  notify/           telegram, email (SMTP sender), emailTemplates, priceAlerts
src/app/            pages: /, /launches, /signals, /whales, /portfolio, /orders,
                    /features, /account, /admin, /token/[address]
src/app/api/        REST routes incl. /api/holders/*, /api/alerts, /api/cron/*, /api/admin/*
src/components/     Nav, AuthButton, BuyPanel, SignalPanel, TopHolders,
                    FeatureGrid, WelcomePanel, LiveLaunches, PwaRegister
supabase/schema.sql database schema (run this)
public/             manifest.webmanifest, sw.js
vercel.json         Vercel config (no crons - cron-job.org drives all schedules)
```

---

## Honest limitations
- Signals and holder PnL are estimates on real data - **not** guarantees.
- Exact per-holder cost basis isn't public; PnL is reconstructed from recent
  swaps and can be partial for very active wallets.
- The public Solana RPC is heavily rate-limited; use a real RPC in production.
- Auto-buy/copy-trade/keeper need a funded server hot wallet and are off until
  you explicitly enable them.


---

## Signal analysis engine (v16)

Every signal is now built from a **mandatory full 24-hour scan** of the token,
followed by four independent analysis layers. Nothing is published until all of
them have run.

### Step 1 - Full 24-hour scan (`src/lib/analysis/window24h.ts`)

The engine reconstructs the entire trailing 24 hours bar by bar at **5-minute
resolution** (up to 288 bars). Tokens younger than ~4 hours automatically fall
back to 1-minute bars so a 90-minute-old token still yields 90 usable bars
instead of 18.

This fixed 24h window is why signals are now **reproducible and regularly
spaced**. Previously the engine analysed whatever candle window happened to be
cached, so the same token could be judged on 20 minutes of tape on one run and
6 hours on the next - which is exactly why signals felt random and arrived at
irregular intervals.

From the session it derives: the true 24h high/low, where price sits inside
that range, session VWAP (the average price everyone actually paid), whether
volume is expanding or dying (second half vs first half), the green/red bar
split, and the volume-weighted buy/sell imbalance.

### Step 2 - Market structure (`src/lib/analysis/structure.ts`)

| Tool | What it answers |
| --- | --- |
| **ZigZag swings** | Where the real swing highs and lows are, ignoring noise |
| **HH / HL / LH / LL** | Is this market genuinely trending or just moving? |
| **BOS** (break of structure) | The trend extended through a prior swing |
| **CHoCH** (change of character) | The first break *against* the trend - early reversal warning |
| **SuperTrend** (ATR bands) | The trend filter; a fresh flip is the actionable event |
| **Key levels** | Swing pivots clustered into support/resistance, scored by touch count |
| **Liquidity zones** | Equal highs/lows where stop orders pile up before a sweep |
| **Fibonacci** | The 38.2-78.6% "golden pocket" pullback entry band |

The ZigZag depth is **auto-scaled from each token's own realised volatility**,
so the same code draws sane swings on a coin moving 0.5% a bar and one moving
40% a bar.

### Step 3 - Chart patterns (`src/lib/analysis/chartPatterns.ts`)

Detected from real ZigZag pivots, not curve-fitted:

- Head & Shoulders and Inverse Head & Shoulders (with neckline + measured target)
- Ascending / Descending / Symmetrical Triangles
- Rising Wedge (bearish) and Falling Wedge (bullish)
- Bull Flag and Bear Flag (pole height projected, volume-dry-up checked)
- Double / Triple Top and Bottom (neckline-measured targets)
- Cup & Handle
- Rectangle / channel ranges, with price position inside the range

Every pattern reports its **trigger level, measured target and invalidation**.
A pattern that cannot produce all three is not emitted, because it is not
tradeable. Head & Shoulders suppresses a Double Top built from the same
shoulders, so one swing is never counted twice.

### Step 4 - Candlestick formations (`src/lib/analysis/candlesticks.ts`)

Single-, two- and three-bar formations with explicit geometry rules:

- **Single:** Hammer, Hanging Man, Shooting Star, Inverted Hammer, Marubozu,
  Spinning Top, Doji, Dragonfly Doji, Gravestone Doji, Long-legged Doji
- **Two-bar:** Bullish/Bearish Engulfing, Bullish/Bearish Harami, Piercing Line,
  Dark Cloud Cover, Tweezer Top, Tweezer Bottom
- **Three-bar:** Morning Star, Evening Star, Three White Soldiers,
  Three Black Crows, Three Inside Up, Three Inside Down

Two rules keep this honest:

1. **Context is required.** A hammer is only a hammer *after a decline*; the
   identical shape after a rally is a hanging man and means the opposite.
   Formations without the correct preceding trend are discarded outright.
2. **Size is relative.** Every threshold is measured against the average real
   body of recent candles, so the rules behave identically on any volatility.

Only one formation is reported per bar (strongest detector wins) and older bars
decay in weight, so a reversal bar from five candles ago that never played out
cannot carry the same weight as the current one.

### Step 5 - Weighted scoring

Every layer casts a **weighted vote** from -1 to +1. The final score is the
weighted average of the evidence that actually exists, so a token with three
inputs is never scored on the same scale as one with twelve.

| Input | Weight |
| --- | --- |
| Market structure (HH/HL vs LH/LL) | 20 |
| EMA trend stack (full 9/21/50) | 22 |
| AI council | 18 |
| Chart pattern (each) | 16 |
| SuperTrend (fresh flip) | 16 |
| 24h session read | up to 16 |
| Safety score | 16-26 |
| Break of structure | 14 |
| MACD / order flow / 1h change | 14 |
| Candlestick cluster | up to 14 |
| RSI | 12 |
| Change of character | 12 |
| Fibonacci / key level proximity | 8 |

Structure carries the heaviest single weight because it answers the only
question that always matters: is this market making higher highs or lower lows?
An oscillator disagreeing with structure is usually the oscillator being wrong.

### Step 6 - Entries, stops and targets from real levels

The stop is built **before** the target, which is the order a risk-managed
trade is actually constructed in.

- **Stop** goes just below the nearest real level - last swing low, a clustered
  multi-touch support, the 24h low, or session VWAP - never at an arbitrary
  percentage. When both a structural stop and a 2-ATR volatility stop exist, the
  tighter of the two is used.
- **T1** is the next genuine level overhead, because that is where the move will
  actually be tested. Only then does the engine project 2-ATR / 4-ATR extensions.
- **Risk/reward is stated explicitly.** If R:R to the first target is below
  1:1, the signal says so in plain language rather than hiding it.
- If price sits in the **top 15% of the 24h range**, the signal explicitly warns
  not to chase.

### Honesty gates

These exist to stop the engine sounding confident when it is not:

- Under 20 candles of history, the call is **forced to neutral** with the reason
  stated - no directional call is issued from price change alone.
- Confidence is scaled by data quality, and again if fewer than a handful of
  independent inputs existed.
- A missing 24h session is reported and reduces confidence.
- Low safety scores hard-cap any bullish score.
- With the AI council enabled, model disagreement **lowers** confidence and the
  split is stated on the signal.

The full read is attached to every signal under `analysis` - structure summary,
swing sequence, SuperTrend, Fibonacci, session stats, key levels, liquidity
pools and detected candlestick formations.


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


---

## Lost access to Supabase?

See **`SUPABASE-REBUILD.md`** for the full fresh-start procedure: recovery steps
to try first, standing up a new project, running the schema, swapping the three
environment variables, reclaiming admin ownership safely, and rotating secrets.

Nothing in the codebase is hardcoded to a Supabase project — only three
environment variables point at it, so migrating is configuration-only:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` `secret` key |

**Read the warning about custodial wallets before you start.** The encrypted
user private keys lived in the old database, and `WALLET_MASTER_KEY` alone
cannot recover them.


---

## Admin login door (ADMIN_LOGIN_PATH)

The admin email-code sign-in form is served by a single runtime route,
`src/app/[loginSlug]/page.tsx`. Its address is decided by `ADMIN_LOGIN_PATH`:

| `ADMIN_LOGIN_PATH` | Sign-in form is at | `/signin` returns |
| --- | --- | --- |
| unset | `/signin` | the form |
| `k7x-control-9f2` | `/k7x-control-9f2` | **404** |

Only one door is ever open. Any slug that is not the configured one returns a
plain 404, byte-identical to any other missing page — a "wrong path" message
would confirm to a scanner that a private door exists.

`/admin` itself never forwards to a private door. It asks
`GET /api/auth/login-path`, which answers `{ private: true, path: null }` when a
custom path is set: the caller learns a private door exists but not where. That
response is readable by any unauthenticated visitor, so returning the path there
would defeat the entire setting.

### Applying a change

`ADMIN_LOGIN_PATH` is read on the server at request time, but Vercel only
injects environment variables into a **new build**. After adding or changing it:

**Deployments → ⋯ → Redeploy → uncheck "Use existing Build Cache"**

Until that finishes, the old door stays open and the new one 404s.

### Order of operations

Set `ADMIN_LOGIN_PATH` only **after** you have confirmed email sign-in works at
the default `/signin`. Setting it first, on a site where SMTP is untested and
your wallet is unavailable, locks both doors at once. Recovery then requires
setting `BOOTSTRAP_ADMIN_WALLET` and redeploying, or promoting a row directly in
the `app_users` table.

This is an obscurity layer on top of the real checks — the role check, the
`ADMIN_LOGIN_EMAILS` allowlist and the rate limits — never a replacement for them.

---

## Wallet history sync (new cron - 10th entry)

Deposits are ordinary Solana transfers. They never touch this app's code, so
nothing could record them and the activity list stayed empty even though the
balance was correct. `/api/cron/wallet-sync` fixes that by reading each
custodial wallet's real signature list from the chain and recording anything
it has not seen before.

Add this to cron-job.org alongside the other nine:

| Job | Path | Every |
| --- | --- | --- |
| Wallet history sync | `/api/cron/wallet-sync` | 5 minutes |

Auth is the same as every other job: send `Authorization: Bearer <CRON_SECRET>`
or append `?key=<CRON_SECRET>`. As with all of them, the endpoint DENIES every
request when `CRON_SECRET` is unset.

The wallet and portfolio pages also call `/api/wallet/sync` on load, so a
deposit that landed seconds ago is visible immediately without waiting for the
cron tick. The cron exists so history stays correct for users who are not
currently looking at the page.

This job is also self-healing for withdrawals: if a transfer is broadcast but
the confirmation wait times out, the old code wrote no row at all and the
amount did not count against the 24h withdrawal cap. The next sync finds the
signature on-chain and records it, closing that gap.


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
