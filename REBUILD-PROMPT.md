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
