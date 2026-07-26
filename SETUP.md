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

`vercel.json` also contains a backup `crons` array. On the Hobby plan Vercel only
honours one daily run per job, so cron-job.org remains the primary driver.
Duplicate runs are harmless: the scanner de-dupes each token for 6 hours and the
keeper is idempotent.

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
