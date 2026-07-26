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
