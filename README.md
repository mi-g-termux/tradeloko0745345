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
4. **Vercel**: import the repo, add env vars, deploy. Cron jobs in `vercel.json`
   run automatically (scan 15m, outcomes 20m, copytrade 5m, keeper 3m, holders
   6h).
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
- Import the repo, add all env vars, deploy. `vercel.json` schedules every cron
  automatically (scan 15m, outcomes 20m, copytrade 5m, keeper 3m, holders 6h,
  **price-alerts 2m**). Set `CRON_SECRET`; Vercel sends it as the bearer token.
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
vercel.json         cron schedule
```

---

## Honest limitations
- Signals and holder PnL are estimates on real data - **not** guarantees.
- Exact per-holder cost basis isn't public; PnL is reconstructed from recent
  swaps and can be partial for very active wallets.
- The public Solana RPC is heavily rate-limited; use a real RPC in production.
- Auto-buy/copy-trade/keeper need a funded server hot wallet and are off until
  you explicitly enable them.
