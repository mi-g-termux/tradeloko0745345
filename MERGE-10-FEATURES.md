# Memecoin Radar — 10-Feature Upgrade Pack

This pack adds **all 10 next features** plus a **welcome/onboarding screen** on top
of the Memecoin Radar project you already downloaded (`memecoin-radar.zip`).

> Why a pack and not a single new zip? The build sandbox was reset mid-build and
> lost the working copy of the full project. Your previously downloaded zip is
> intact and is the base. This pack contains only the **new** and **changed**
> files, which drop straight into that project.

## How to apply (2 minutes)

1. Unzip this pack over your existing project folder, keeping the same paths
   (`src/...`, `supabase/...`, `public/...`, `vercel.json`). When asked, **replace**
   the files listed as *changed* below.
2. Run the updated SQL: open `supabase/schema.sql` in the Supabase SQL editor and
   run it (it is idempotent — safe to re-run; it only adds new tables/columns).
3. Do the 4 tiny manual edits in **"Wire up the UI"** below.
4. `npm install` (no new dependencies were added) and deploy as usual.

---

## The 10 features

| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| 1 | **New launch radar** | Newest tokens + instant safety pre-screen + live pump.fun websocket feed | `data/launches.ts`, `components/LiveLaunches.tsx`, `app/launches/page.tsx`, `api/launches` |
| 2 | **Copy-trade automation** | Mirrors buys from copy-enabled tracked wallets through the safety+spend rails | `analysis/copytrade.ts`, `api/cron/copytrade` |
| 3 | **Signal outcome tracking** | Records entry price, backfills 1h/24h returns → a real hit-rate on /signals | `analysis/outcomes.ts`, `api/cron/outcomes`, `api/signals` |
| 4 | **Portfolio & PnL** | Live on-chain holdings priced in real time, with cost basis | `data/portfolio.ts`, `app/portfolio/page.tsx`, `api/portfolio` |
| 5 | **Personal Telegram alerts** | Per-user watchlist alerts to your own chat id | `notify/telegram.ts` (notifyWatchers), `app/account/page.tsx`, `api/account`, `api/watchlist` |
| 6 | **Deeper safety** | New liquidity/market-cap factor + holder-concentration trend snapshots | `data/safety.ts`, `data/holderTrend.ts`, `api/cron/holders` |
| 7 | **Limit / TP / SL keeper** | Trigger-price buys + take-profit/stop-loss sells executed by a cron | `trade/limitOrders.ts`, `trade/execute.ts`, `app/orders/page.tsx`, `api/limit-orders`, `api/cron/keeper` |
| 8 | **Multi-admin roles** | viewer < trader < admin < owner; owners manage roles | `auth/session.ts`, `auth/users.ts`, `api/admin/users` |
| 9 | **Rate-limit & caching** | In-memory TTL cache + per-IP rate limiting on public routes | `cache.ts` (used across launches/portfolio/features/signals) |
| 10 | **Mobile PWA** | Installable app with a service worker | `public/manifest.webmanifest`, `public/sw.js`, `components/PwaRegister.tsx` |
| ➕ | **Onboarding / "all options"** | Welcome panel on the home page + `/features` directory showing every capability and whether it's live/needs-setup/off | `lib/features.ts`, `components/FeatureGrid.tsx`, `components/WelcomePanel.tsx`, `app/features/page.tsx`, `api/features` |

---

## Files in this pack

**New files** (just copy in):
- `src/lib/cache.ts`
- `src/lib/features.ts`
- `src/lib/trade/execute.ts`
- `src/lib/trade/limitOrders.ts`
- `src/lib/data/launches.ts`
- `src/lib/data/portfolio.ts`
- `src/lib/data/holderTrend.ts`
- `src/lib/analysis/outcomes.ts`
- `src/lib/analysis/copytrade.ts`
- `src/components/FeatureGrid.tsx`, `WelcomePanel.tsx`, `LiveLaunches.tsx`, `PwaRegister.tsx`
- `src/app/features/page.tsx`, `launches/page.tsx`, `portfolio/page.tsx`, `orders/page.tsx`, `account/page.tsx`
- `src/app/api/features/route.ts`, `launches/route.ts`, `portfolio/route.ts`, `account/route.ts`, `watchlist/route.ts`, `limit-orders/route.ts`, `admin/users/route.ts`
- `src/app/api/cron/copytrade/route.ts`, `outcomes/route.ts`, `holders/route.ts`, `keeper/route.ts`
- `public/manifest.webmanifest`, `public/sw.js`

**Changed files** (replace your existing ones):
- `supabase/schema.sql`
- `src/lib/adminConfig.ts`, `types.ts`, `auth/session.ts`, `auth/users.ts`
- `src/lib/data/safety.ts`, `src/lib/solana/jupiter.ts`
- `src/lib/analysis/signal.ts`, `scanner.ts`, `src/lib/notify/telegram.ts`
- `src/app/api/signals/route.ts`
- `vercel.json`

**Unchanged** (kept from your existing project — not included here): `config.ts`,
`http.ts`, `supabase.ts`, `format.ts`, `solana/rpc.ts`, `data/dexscreener.ts`,
`data/candles.ts`, `data/twitter.ts`, `data/whales.ts`, `analysis/technical.ts`,
`analysis/ai.ts`, and all existing pages/components/routes.

---

## Wire up the UI (4 tiny edits)

These touch files that already exist in your project, so paste these snippets in.

### 1) Home page — show the welcome panel
In `src/app/page.tsx`, add the import and render it at the top of the returned JSX:
```tsx
import WelcomePanel from "@/components/WelcomePanel";
// ...inside the top-level <main> / container, as the first child:
<WelcomePanel />
```

### 2) Navigation — add the new pages
In `src/components/Nav.tsx`, add these links:
```tsx
<a href="/features">Features</a>
<a href="/launches">Launches</a>
<a href="/signals">Signals</a>
<a href="/portfolio">Portfolio</a>
<a href="/orders">Orders</a>
<a href="/account">Account</a>
```

### 3) Layout — enable the PWA
In `src/app/layout.tsx`, add the manifest link + register the service worker:
```tsx
import PwaRegister from "@/components/PwaRegister";

export const metadata = {
  // ...keep your existing metadata,
  manifest: "/manifest.webmanifest",
  themeColor: "#0a0c10",
};

// inside <body>, as the first child:
<PwaRegister />
```
(Optional: add `public/icon-192.png` and `public/icon-512.png` for a custom install icon.)

### 4) Admin panel — expose the new toggles
Your admin config API already round-trips these new keys. In
`src/app/api/admin/config/route.ts`, add to the `PLAIN_KEYS` array:
```ts
"copy_trade_enabled", "launch_feed_enabled", "keeper_enabled"
```
Then add three toggles in `src/app/admin/page.tsx` next to the existing ones
(Copy-trade, Launch feed, Keeper). They map to `copyTradeEnabled`,
`launchFeedEnabled`, `keeperEnabled`.

---

## New environment variables

| Var | Needed for | Notes |
|-----|-----------|-------|
| `AUTO_BUY_SIGNER_KEY` | auto-buy, copy-trade, keeper buys/sells | base58 secret key of a **dedicated hot wallet**. Fund it only with what you'll trade. Never your main wallet. |
| `CRON_SECRET` | securing the cron endpoints | set the same value in Vercel; Vercel Cron sends it automatically as a Bearer token. |

Everything else (Supabase, Helius, Gemini, X, Telegram, RPC) is unchanged from
your existing setup.

---

## Safety reminder
All automation (copy-trade, auto-buy, keeper) is **off by default** and only
acts when you enable it in the admin panel AND provide a funded signer key.
Every buy passes a per-trade cap, a mandatory safety score, and a daily spend
cap. Signals are probabilities, not guarantees — memecoins are extremely high
risk.
