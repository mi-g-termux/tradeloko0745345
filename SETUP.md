# MemePump — deployment & scheduling setup

This is the operational checklist. Do these in order; the signal engine cannot
work on a schedule until steps 2 and 4 are done.

---

## 1. Run the database migration

Open Supabase → SQL Editor → paste the **whole** of `supabase/schema.sql` → Run.

The file is idempotent (`create table if not exists`, `add column if not exists`),
so running it again on an existing database is safe. It adds, among the existing
tables:

| Object | Purpose |
| --- | --- |
| `admin_config.brand_name / logo_url / favicon_url / logo_height / show_brand_name / accent_color / ads_enabled` | Branding + ads settings edited from the admin panel |
| `site_ads` | Ad creatives (slot, image or HTML snippet, link, weight, impressions, clicks) |
| `bump_ad_counter(ad_id, counter)` | Atomic impression/click counting |
| `cron_runs` | Heartbeat log for every scheduled job |
| `prune_cron_runs()` | Optional 7-day retention cleanup |

---

## 2. Environment variables (Vercel → Settings → Environment Variables)

**Required**

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Never expose to the browser. |
| `SESSION_SECRET` | Any long random string (`openssl rand -hex 32`) |
| **`CRON_SECRET`** | **Any long random string. Without it every cron endpoint returns 401 and no scheduled signals are produced.** |
| `NEXT_PUBLIC_APP_URL` | e.g. `https://yourapp.vercel.app` — no trailing slash |

**Recommended**

| Variable | Unlocks |
| --- | --- |
| `SOLANA_RPC_URL` | Reliable holder/whale data (public RPC is rate-limited) |
| `HELIUS_API_KEY` | Whale tracking, holder snapshots, launch feed |
| `GEMINI_API_KEY` | AI second opinion on signals (free tier at aistudio.google.com) |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Signal delivery to Telegram |
| `X_BEARER_TOKEN` | Social sentiment factor |
| `WALLET_MASTER_KEY` | Required for in-app custodial wallets (AES-256-GCM) |
| `AUTO_BUY_SIGNER_KEY` | Only if you enable auto-buy / copy-trade |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | Email alerts |
| `BOOTSTRAP_ADMIN_WALLET` | Wallet that becomes owner on first sign-in |
| `ADMIN_RECOVERY_SECRET` | 24+ char random string. Break-glass admin recovery via `/recover` if the owner wallet is lost. Set this **before** you need it |

Most provider keys can alternatively be pasted in **Admin → API keys**, which
stores them in the database and overrides the env values.

---

## 3. First sign-in

The **first** person who ever signs in becomes the permanent `owner`. Everyone
after that is a `viewer`. Promote people in **Admin → Members**.
Hierarchy: `viewer → trader → admin → owner`.

---

## 4. cron-job.org schedule (this is what makes signals arrive on time)

Every job lives at `https://YOUR-DOMAIN/api/cron/<job>` and is authorised in any
of three ways:

- Header `Authorization: Bearer YOUR_CRON_SECRET`  ← recommended
- Header `x-cron-secret: YOUR_CRON_SECRET`
- Query string `?key=YOUR_CRON_SECRET`

Create one cron-job.org job per row (method **GET**, enable *Save responses* and
*Failure notifications*):

| Job URL | Interval | cron expression | What it does |
| --- | --- | --- | --- |
| `/api/cron/scan` | 15 min | `*/15 * * * *` | Main scanner: builds signals, alerts qualifying setups |
| `/api/cron/signal-updates` | 15 min | `*/15 * * * *` | Follow-up pump alerts on already-signalled tokens |
| `/api/cron/price-alerts` | 5 min | `*/5 * * * *` | User price-condition alerts |
| `/api/cron/keeper` | 5 min | `*/5 * * * *` | Limit / take-profit / stop-loss execution |
| `/api/cron/whale-signals` | 10 min | `*/10 * * * *` | Analyses tokens your tracked whales just bought |
| `/api/cron/copytrade` | 10 min | `*/10 * * * *` | Mirrors tracked-wallet buys (if enabled) |
| `/api/cron/user-autotrade` | 15 min | `*/15 * * * *` | Per-user auto-trade sweep (if enabled) |
| `/api/cron/outcomes` | 30 min | `*/30 * * * *` | Backfills 1h/24h returns so signal accuracy is measurable |
| `/api/cron/holders` | 60 min | `0 * * * *` | Holder-count snapshots for watchlisted tokens |

The exact URLs, cron expressions and copy buttons are also generated for you in
**Admin → Automation & cron → cron-job.org setup**.

### Response format

Every job returns JSON and a meaningful HTTP status, so cron-job.org can tell
success from failure:

```json
{ "ok": true, "job": "scan", "status": "ok", "durationMs": 4120,
  "result": { "scanned": 12, "qualified": 3, "alerted": 2 },
  "ranAt": "2026-07-26T12:00:04.120Z" }
```

- `401` — wrong or missing secret (the body tells you which header to send).
- `"status": "skipped"` with a `reason` — the feature is switched **off** in the
  admin panel. cron-job.org still sees a 200; the admin panel shows *skipped*.
- `500` — the job threw. cron-job.org marks it FAILED and the error text is
  stored in `cron_runs` and shown in **Admin → Automation & cron → Cron health**.

**`vercel.json` deliberately contains NO `crons` array.** cron-job.org is the
only scheduler, and Vercel crons are not a usable backup here:

- On **Hobby**, cron jobs may run **once per day maximum**. Any expression that
  fires more often (`0 * * * *`, `*/30 * * * *`) **fails at deploy time** with
  *"Hobby accounts are limited to daily cron jobs."* Adding backup crons would
  break your deployment, not protect it.
- Even a legal daily Hobby cron has **±59 minutes** of jitter, which is useless
  for a 5-minute scanner.

So every cadence in this app comes from cron-job.org. Do not add a `crons` array
unless you upgrade to Pro (per-minute scheduling); if you do, the endpoints are
already idempotent — the scanner de-dupes each token for 6 hours and the keeper
is safe to run twice.

---

## 5. Branding, favicon and ads

**Admin → Branding**
- *Logo URL* → shown top-left in the navbar on every page. Accepts `https://…`,
  a repo path such as `/logo.png` (put the file in `public/`), or a
  `data:image/…;base64,…` URI. Anything else is rejected.
- *Logo height* → 14–64 px, width scales automatically.
- *Show app name* → turn OFF when your logo already contains the wordmark.
- *Favicon URL* → browser-tab icon. Falls back to the logo, then to the bundled
  `/icon.svg`.
- *Accent colour* → recolours buttons, active tabs and links site-wide.

**Admin → Ads**
- One master switch. When OFF, no ad markup reaches the browser at all.
- Five slots: `top_banner`, `sidebar`, `scanner_inline`, `token_page`, `footer`.
- Each creative is either an **image + click-through URL** (impressions and
  clicks are counted, CTR is shown) or a pasted **ad-network snippet**
  (AdSense / Coinzilla / A-ADS). Script tags in snippets are re-created client
  side so they actually execute.
- Several creatives in one slot rotate by weight, so you can A/B them.

---

## 6. Verifying it works

1. **Admin → Automation & cron → Run a scan now.** You should get a line like
   `Scanned 12, qualified 3, alerted 2`. If it says `0 scanned`, DexScreener
   returned nothing — retry, it is rate-limited occasionally.
2. Wait one interval, then check **Cron health**. Each job should show a recent
   *last run* and `ok`. `overdue` means cron-job.org is not calling it.
3. Open any token page → **Analysis & signal**. The *Evidence* line shows how
   many candles the call was based on. Fewer than 20 candles → the engine
   deliberately reports `neutral`; that is correct behaviour on a minutes-old
   token, not a bug.

---

## Telegram buy button (v2.1)

**The old button was dead by construction.** It pointed at
`appBaseUrl() + "/token/<mint>"`, and `appBaseUrl()` falls back to
`http://localhost:3000` when `NEXT_PUBLIC_APP_URL` / `APP_URL` / `VERCEL_URL`
are all unset. Telegram renders that as a normal button, but tapping it opens
*the reader's own device*, so nothing happens. The keyboard also linked
`pump.fun/<mint>` for every token, which 404s for anything not on pump.fun.

### What to do

1. Run the migration at the bottom of `supabase/schema.sql` (adds
   `tg_buy_route`, `tg_buy_ref`, `tg_buy_template`).
2. Admin panel -> **Alerts** -> Telegram -> **Buy button**, choose a route:

   | Route | Works on | Referral | Notes |
   | --- | --- | --- | --- |
   | **Jupiter** (default) | all devices | no | Any SPL mint, zero setup. |
   | BONKbot | Telegram **mobile only** | yes | Documented deeplink `ref_<code>_ca_<mint>`. |
   | Trojan | Telegram **mobile only** | yes | `r-<ref>-<mint>`. |
   | GMGN | all devices | no | Web token page with a buy panel. |
   | Custom template | all devices | yes | `{ca}` and `{ref}` placeholders, for Photon / BullX / Axiom / Maestro. |
   | This site's trade page | all devices | no | Needs `NEXT_PUBLIC_APP_URL`. |

3. Set `NEXT_PUBLIC_APP_URL` to your real domain (e.g.
   `https://yourdomain.vercel.app`) so the "Full analysis" button appears at all.
   Without it that button is simply omitted rather than shipped dead.

### Guarantees now in the code

- Every button URL passes `isTelegramSafeUrl()`: http/https only, real TLD, no
  `localhost` / `127.0.0.1` / private LAN / `.local`. **A missing button is
  better than a dead one.**
- If your chosen route is a Telegram bot, a **Jupiter web link is added
  automatically**, because bot deeplinks do not work on Telegram Desktop
  (documented Telegram/BONKbot limitation, not a bug in this app).
- The buy link is repeated in the message body as a tappable HTML link, so the
  alert stays actionable even if the inline keyboard is stripped.
- `sendMessage` failures now log Telegram's actual `description` (e.g.
  `BUTTON_URL_INVALID`) instead of being swallowed, and the alert is retried
  once without the keyboard so one bad button can never lose the whole signal.

### Verify in 30 seconds

Admin -> Alerts, save, then Automation -> **Run a scan now**. On the alert that
arrives, long-press the buy button and copy the link: it must start with
`https://jup.ag/swap/SOL-` (or your chosen route) and contain the full mint.
If you are on Telegram Desktop and picked BONKbot/Trojan, use the Jupiter
button next to it — that is expected behaviour.

---

## Admin access & lockout recovery (v2.2)

### The problem

Admin rights are a `role` value on one row in `app_users`, and that row is
normally reached through **one wallet**. Lose the wallet — phone reset, lost seed
phrase, dead device — and `/admin` becomes unreachable forever. Nothing else in
the app can grant it back.

There are now **four independent ways back in**, in the order you should rely on
them.

### Layer 1 (best) — keep two owners on different login methods

This is prevention, and it costs nothing. Do it today.

1. Sign in with your **Telegram** login (a second, separate account).
2. From your wallet account: **Admin → Members → set that account to `owner`**.

Now either credential opens the admin panel. Losing a wallet becomes an
inconvenience instead of a lockout. Note only an **owner** may grant
admin/owner — an `admin` cannot promote anyone, by design.

### Layer 2 — `/recover` with a recovery secret

Set this up **before** you need it:

1. Generate a long random secret:
   ```bash
   openssl rand -hex 32
   ```
2. Add it in Vercel → Settings → Environment Variables as
   `ADMIN_RECOVERY_SECRET`, then redeploy.

To use it after a lockout:

1. Sign in with **any** method that still works — Telegram login, or a brand new
   wallet. You get an ordinary `viewer` account.
2. Go to **`/recover`**, paste the secret, submit.
3. That account becomes `owner`. Rotate the secret afterwards.

Why this is safe:

- **Disabled unless the env var is set** — no env var, no attack surface.
- **Rejects secrets under 24 characters**, since this endpoint grants full
  ownership.
- **Constant-time comparison**, so the secret cannot be extracted byte-by-byte
  through response timing.
- **Requires an existing session**, so an anonymous visitor cannot promote
  anything even if the secret leaked.
- **Rate limited** to 5 attempts / 10 minutes, every attempt logged, and a
  success posts a warning to your Telegram broadcast chat so a silent takeover is
  impossible.

The secret lives in your hosting dashboard, which you reach with an
email/password login — deliberately independent of any wallet or seed phrase.

### Layer 3 — `BOOTSTRAP_ADMIN_WALLET`

Set this to a wallet address and that wallet is promoted to `owner` the first
time it signs in, regardless of sign-up order. Useful for pinning ownership to a
hardware wallet. It still depends on holding *a* wallet, so it is not a recovery
method on its own.

### Layer 4 (always works) — one line of SQL

You own the Supabase project, so you can always grant yourself access directly.
This works even if the app is completely broken. Supabase → SQL Editor:

```sql
-- See who currently has access
select id, wallet_address, telegram_username, role, last_login_at
from app_users order by created_at;

-- Promote by wallet...
update app_users set role = 'owner', is_admin = true
where wallet_address = 'YourWalletAddressHere';

-- ...or by Telegram username
update app_users set role = 'owner', is_admin = true
where telegram_username = 'your_telegram_username';
```

Sign out and back in afterwards so the session reloads your new role.

### Recommended setup

Do all three of these once and you can never be locked out:

1. Two owner accounts on two different login methods (Layer 1).
2. `ADMIN_RECOVERY_SECRET` set in Vercel (Layer 2).
3. Supabase login details stored in your password manager (Layer 4).

## Email sign-in for admins (v2.2)

The wallet is no longer the only way into `/admin`. An admin can sign in from any
device — laptop, borrowed phone, new browser — with a code emailed to them.

**Route:** `/signin` (also linked as "Email" beside the Connect Wallet button)

### How it works

1. Admin enters their email address at `/signin`.
2. If that address belongs to an account that **already exists** and **already has
   the admin or owner role**, a 6-digit code is emailed.
3. Admin types the code. A normal session cookie is issued — identical to a wallet
   or Telegram login — and they land on `/admin`.

### One-time setup (do this while you still have wallet access)

1. Sign in with your wallet, open **Account & alerts**, save your email address.
2. In the admin panel, fill in the **SMTP settings** and press the test-email
   button until it succeeds. Without working SMTP, no code can be delivered.

That's it — no extra environment variable is needed. It reuses the same SMTP
configuration as trade and price-alert emails.

### Why a code and not a magic link

Click-to-login links get opened automatically by mail scanners, link previewers,
and corporate proxies, which can consume or trigger the login without the admin
doing anything. A typed 6-digit code requires an actual human.

### Security properties

| Protection | Behaviour |
| --- | --- |
| Codes at rest | Only a SHA-256 hash is stored. A database leak cannot be used to sign in. |
| Expiry | 10 minutes, single use. Burned before the session is opened, so it cannot be replayed. |
| Wrong guesses | 5 per code, then the code is dead. |
| Request flooding | Max 5 codes per address per hour. |
| Email enumeration | Unknown and non-admin addresses get the exact same response, so nobody can discover who your admins are. |
| Privilege escalation | Cannot create accounts and cannot promote a viewer. It only opens a session for an account that is *already* an admin. |
| Comparison | Constant-time (`timingSafeEqual`), so the code cannot be extracted by measuring response times. |
| Delivery | Sent with `force: true`, so it still works when the global email-notifications toggle is off. |

### The three ways in, in order

1. **Wallet or Telegram** — normal, day-to-day.
2. **`/signin` email code** — different device, wallet not available. *This is the
   answer to "I want to log in from my laptop."*
3. **`/recover` + `ADMIN_RECOVERY_SECRET`** — break-glass only, when no admin
   account is reachable at all. See the lockout-recovery section above.

### Database

Re-run `supabase/schema.sql` after upgrading. It adds the `email_login_codes`
table plus a case-insensitive index on `app_users.email`. The script is
idempotent — safe to run on an existing database.


---

## Security hardening (v2.3)

Run `supabase/schema.sql` again after deploying this version. Everything in it is
`if not exists`, so re-running is safe.

**One-time side effect:** the session system changed, so *every user (including
you) is signed out once* after this deploy. Sign in again normally.

### What changed

| # | Area | Before | Now |
|---|------|--------|-----|
| 1 | Wallet key derivation | A passphrase master key became a bare SHA-256 hash: fast to brute-force | Passphrases go through `scrypt` (N=32768); a 64-hex key is used directly |
| 2 | Wallet key scope | One global key encrypted every wallet | Per-user key via HKDF-SHA256; one leaked user key cannot open another wallet |
| 3 | Sessions | Stateless signed cookie, impossible to revoke for 7 days | Random token, SHA-256 hash stored in `user_sessions`, revocable instantly |
| 4 | Session management | None | `GET/POST /api/auth/sessions` lists devices and signs out one / others / all |
| 5 | Withdrawals | Any valid session could drain the full balance | Per-transfer cap, rolling 24h cap, optional address allowlist |
| 6 | Withdrawals (2FA) | None | Optional emailed code, bound to that exact amount + destination, single-use |
| 7 | Rate limiting | In-memory counters (useless on serverless) | `rate_hits` table, shared across instances, with `Retry-After` |
| 8 | Paid API proxies | Unlimited public access to Helius/Birdeye/Gemini-backed routes | Per-IP limits on `tokens`, `candles`, `analysis`, `holders`, `safety` |
| 9 | Input validation | Hand-rolled `String()` / `Number()` coercion | `zod` schemas on withdraw, wallet settings, sessions |
| 10 | Database exposure | RLS off: the public anon key could read every table | RLS enabled on all 23 tables, deny-by-default |
| 11 | `/recover` | Reusable shared secret granted permanent `owner` | Deleted entirely, along with `ADMIN_RECOVERY_SECRET` |

### Install the new dependency

```bash
npm install        # picks up zod
```

### Wallet key quality

`WALLET_MASTER_KEY` should be a 64-character hex string:

```bash
openssl rand -hex 32
```

Existing wallets encrypted with the old scheme (`v1.` ciphertext) keep working and
are re-encrypted to the new per-user scheme automatically the first time each
wallet is used. Do **not** change `WALLET_MASTER_KEY` after wallets exist - that
makes every stored key undecryptable.

### Withdrawal limits

Defaults for every account, adjustable per user via `PUT /api/wallet/settings`:

- `maxWithdrawSol`: 5 (single transfer)
- `dailyWithdrawCapSol`: 10 (rolling 24 hours)
- `withdrawConfirmRequired`: false (set true to require an emailed code)
- `withdrawAllowlist`: empty (when non-empty, only those addresses are allowed)

Set a cap to `0` to mean "no limit".

---

## Cron jobs: what to schedule at cron-job.org

`vercel.json` contains **no** `crons` array and must stay that way - Vercel Hobby
rejects anything more frequent than once per day at deploy time. All scheduling
is external.

### Required setup, once per job

- **URL:** `https://YOUR-DOMAIN/api/cron/<job>`
- **Method:** GET (POST also works)
- **Header:** `Authorization: Bearer YOUR_CRON_SECRET`
  (cron-job.org: *Advanced* -> *Headers*). `x-cron-secret: YOUR_CRON_SECRET`
  works too, and `?key=YOUR_CRON_SECRET` is available for quick curl testing.
- If `CRON_SECRET` is unset the endpoints return 401 and never run. That is
  deliberate: an unauthenticated job trigger is a free DoS button.

### The nine jobs

| # | URL path | Every | What it does | Priority |
|---|----------|-------|--------------|----------|
| 1 | `/api/cron/scan` | 15 min | Scans the market and creates new signals | Essential |
| 2 | `/api/cron/signal-updates` | 15 min | Follow-ups on open signals | Essential |
| 3 | `/api/cron/price-alerts` | 5 min | Fires user price alerts | Essential |
| 4 | `/api/cron/keeper` | 5 min | Executes limit / stop orders | Essential if trading is on |
| 5 | `/api/cron/whale-signals` | 10 min | Whale-buy detection | Recommended |
| 6 | `/api/cron/copytrade` | 10 min | Mirrors tracked wallets | Only if copy-trade is used |
| 7 | `/api/cron/user-autotrade` | 15 min | Per-user auto-trade execution | Only if auto-trade is on |
| 8 | `/api/cron/outcomes` | 30 min | Scores past signals + security housekeeping | Essential |
| 9 | `/api/cron/holders` | 60 min | Holder-concentration snapshots | Recommended |

Nine entries total - nothing more is needed. Job 8 also runs
`purge_security_rows()`, which trims `rate_hits`, expired sessions, and used
one-time codes, so no extra cleanup schedule is required.

### Free-tier reality check

cron-job.org's free plan runs jobs at most **every minute**, so all nine
cadences fit. If you are limited to fewer jobs, keep 1, 3, 4 and 8 and lengthen
the rest. Signals go stale quickly, so `scan` should never be slower than
30 minutes.

### Verifying they run

The admin panel's cron tab reads `cron_runs` and shows last run, duration,
errors in 24h, and an **overdue** flag (2.5x the expected interval). If a job
shows overdue, the schedule at cron-job.org is wrong, paused, or the secret
header is missing.


---

## Public site URL, Telegram links, and RPC (read this before going live)

### Why the Telegram "Full analysis" button pointed at a strange URL

On Vercel every single deployment gets its own permanent hostname, like
`memepumps-f54lx2t2g-yourname.vercel.app`, in addition to your real domain.
When no canonical URL was configured, the app fell back to whichever hostname
the cron request happened to arrive on, which is one of those per-deployment
hostnames. The link worked, but it pointed at one frozen old build instead of
the site your users actually visit.

### The fix: set it once in the admin panel

**Admin -> Providers -> Public site URL**

Enter your real origin, with no trailing slash:

- Vercel: `https://memepumps.vercel.app`
- Custom domain: `https://yourdomain.com`
- cPanel: `https://yourdomain.com`

Every Telegram button, buy link and email link uses this value first. It is
stored in the database, so **moving to cPanel or a custom domain needs no code
change and no redeploy** - you edit this one field and the next signal already
carries the correct domain.

If you leave it empty the app still falls back to the observed request host, so
nothing breaks; it just is not guaranteed to be the domain you want.

### Top holders showing "429 Too Many Requests"

**Cause.** Without an RPC key the app uses `api.mainnet-beta.solana.com`, the
free public Solana endpoint. It is rate-limited **per IP address**, and on a
serverless host that IP is shared with every other project on the same machine.
So the quota can already be exhausted by strangers before your first request,
which is why the Top holders tab failed while the rest of the page loaded (the
price, liquidity and volume numbers come from DexScreener, not from RPC).

**Best free fix: Helius.** Free tier, no card required, and it gives you a
dedicated quota instead of a shared one.

1. Sign up at <https://helius.dev> and copy the API key.
2. Paste it in **Admin -> Providers -> Helius API key**.

That alone resolves the 429. Other options, in order of preference:

| Provider | Free tier | Notes |
| --- | --- | --- |
| Helius | Yes | Best free option; also powers whales/launches |
| QuickNode | Limited free | Reliable, good for a backup endpoint |
| Triton / Alchemy | Limited free | Fine as a secondary |
| Public mainnet-beta | Unmetered but shared | Last-resort fallback only |

The app now also does this automatically:

- **Failover order:** Helius key -> primary RPC URL -> backup RPC URL -> public.
- A 429 or 5xx retries once, then moves to the next endpoint.
- Holder results are cached for 60 seconds, so repeat views cost no quota.

Set **Backup Solana RPC URL** in Admin -> Providers for a second endpoint.

### AI council (multi-model signals)

Add any combination of Gemini, OpenAI, Anthropic, Groq and DeepSeek keys in
**Admin -> Providers**, then switch on **AI council** in Admin -> Automation.

All configured models are asked the *same* question in parallel and their
answers are compared:

- Unanimous agreement keeps the full confidence.
- A split lowers it, and the signal states which models disagreed.

With one key it behaves exactly like before. Groq has a usable free tier if you
want a second opinion at no cost.


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


### Boost payments are credited automatically

A token team does **not** have to submit anything after paying. Two paths, both
hands-off:

- **From their in-app wallet** - one click, activated instantly.
- **From any external wallet** - they send the SOL to the payout address and
  stop. `/api/cron/boost-watch` reads that address, matches the incoming
  transfer to the pending order, and activates the boost. The `/boost` page also
  runs the same check when it loads, so a buyer who refreshes usually sees it
  credited immediately rather than waiting for the next tick.

The signature box on `/boost` is only a fallback for someone impatient, or for
when the RPC is throttled. It is no longer the normal route.

**How a payment is matched to an order (and why it is safe):**
- A signature already recorded against any boost is skipped, and a unique index
  on the column is the real guarantee - one payment can never fund two boosts.
- A transfer only matches an order created **before** it (ten minutes of slack
  for clock drift), so an old unrelated payment cannot activate a new order.
- If several pending orders fit, the most expensive one the payment covers wins,
  so the buyer gets the tier they actually paid for.
- Overpaying by more than 25% is left pending for manual review rather than
  being quietly swallowed.
- The amount is read from the payout account's real balance change on a
  confirmed transaction, not from anything the buyer claims.

With no pending orders the job returns before making a single RPC call, so it is
free to run every 5 minutes.

**cron-job.org now has 12 entries.** The two boost jobs are:

| Path | Every |
| --- | --- |
| `/api/cron/boost-watch` | 5 min |
| `/api/cron/boost-expire` | 60 min |


### Boost checkout, admin grants and receipts

**The checkout works like a hosted crypto payment page.** When a buyer picks a
package, the server generates a brand-new Solana address that belongs to that
order and nothing else, and shows it as the payment address. Because no other
order shares it, any SOL arriving there is proof of payment for that exact
order - there is no amount guessing, no memo, no reference to paste, and no way
to credit the wrong buyer.

The `boost-watch` cron job (every 5 minutes) checks the balance of each pending
order's address. When it sees the money it:

1. Flips the order to `active` and starts the clock from that moment, so a buyer
   who pays late still gets the full duration.
2. Sweeps the balance to your payout wallet automatically, minus the network
   fee. If the sweep fails the funds stay in an address only your server can
   spend, and the next run retries it.
3. Emails the buyer a receipt, and a copy to you.

Refreshing the `/boost` page also triggers a check, so payment usually shows as
confirmed within seconds rather than waiting for the cron.

Orders created before this existed shared one payout wallet. Those still work:
the watcher scans that wallet's recent transfers and matches on amount.

**Requires `WALLET_MASTER_KEY`.** The per-order address secret is encrypted with
it, exactly like a user wallet. If it is not set, checkout falls back to the
shared payout wallet and amount matching - the sale still works, it is just less
precise.

**Admin grants.** Admin panel -> Boosts -> "Add a boost yourself". Enter a token
address, tier and duration, and it goes live immediately with no payment. It is
recorded at a price of 0 with `granted_by` set to your name, so granted boosts
never get mixed up with sold ones in your numbers.

**Receipts.** Admin panel -> Boosts -> "Receipts" sets the address your copy is
sent to. Leave it blank to fall back to `ADMIN_LOGIN_EMAILS`. Requires SMTP set
up in the Alerts tab. Receipts are sent once per order and never duplicated,
even if a cron run is retried.
