# MemePump - Full Deployment Guide (A to Z)

Covers Vercel, cPanel (Node.js hosting), and any generic VPS / Render / Railway.
Follow the sections in order. Nothing here is optional unless marked OPTIONAL.

---

## A. What you need before you start

| Thing | Cost | Why |
|---|---|---|
| GitHub account | free | source of truth for deploys |
| Supabase project | free tier is fine | the database (Postgres) |
| Node.js 18.17+ (20 LTS recommended) | free | building the app |
| A Solana wallet (Phantom) | free | first sign-in becomes the permanent OWNER |
| SMTP credentials | free-ish | admin email login + alerts |
| cron-job.org account | free | runs the scheduled jobs |
| Domain name | OPTIONAL | custom branding |

Node version check:

    node -v

If it prints less than v18.17, upgrade first. The build will fail on older Node.

---

## B. Get the code into GitHub

If you already have the repo, skip to step B4.

1. Extract the delivered zip.
2. In the extracted folder:

       git init
       git add -A
       git commit -m "MemePump initial"

3. Create an EMPTY repo on GitHub (no README), then:

       git remote add origin https://github.com/<you>/<repo>.git
       git branch -M main
       git push -u origin main

4. Updating later (this is the step people forget - Vercel only ever builds what
   is in GitHub, never what is on your laptop):

       git add -A
       git commit -m "describe the change"
       git push

   After pushing, confirm the commit hash in the Vercel build log CHANGED. If it
   shows the same hash as the previous failed build, your push did not land and
   you are looking at old code.

---

## C. Create the database (Supabase)

1. supabase.com -> New project. Pick a region near your users. Save the DB
   password somewhere safe.
2. Wait until the project finishes provisioning.
3. Open **SQL Editor** -> New query.
4. Open `supabase/schema.sql` from this project, copy the **ENTIRE FILE**, paste,
   and click Run.

   Do NOT paste only a section. Postgres runs the script as one transaction, so a
   partial paste that references a table you never created rolls the whole thing
   back and you end up with nothing. The script is safe to run repeatedly
   (`create table if not exists` throughout, and the RLS step skips tables that
   do not exist yet).

5. Verify it worked. Run this:

       select count(*) as tables
       from pg_tables
       where schemaname = 'public'
         and tablename in (
           'app_users','admin_config','site_ads','cron_runs','user_wallets',
           'user_sessions','rate_hits','withdraw_confirmations','email_login_codes',
           'signals','watchlist','price_alerts','limit_orders'
         );

   Expect **13**. Anything less means the script did not finish - re-read the
   error and run the whole file again.

6. Collect your keys from **Project Settings -> API**:
   - Project URL -> `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key -> `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret -> `SUPABASE_SERVICE_ROLE_KEY`

   The service_role key bypasses all row-level security. It goes in server env
   vars ONLY. Never put it in any `NEXT_PUBLIC_*` variable, never commit it.

---

## D. Generate your secrets

Run each of these and keep the output:

    openssl rand -hex 32     # WALLET_MASTER_KEY  (must be 64 hex chars)
    openssl rand -hex 32     # SESSION_SECRET
    openssl rand -hex 24     # CRON_SECRET

No openssl (Windows)? Use:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

**WALLET_MASTER_KEY is the most important value in the entire system.** Every
custodial wallet private key in `user_wallets.secret_enc` is encrypted with a key
derived from it. Consequences:

- Lose it -> every custodial wallet is permanently unrecoverable. Funds gone.
- Leak it + a copy of the DB -> attacker drains every custodial wallet.
- Change it after users have wallets -> all existing wallets stop decrypting.

Set it ONCE, before launch. Back it up in a password manager. Never rotate it
casually, and never commit it to git.

---

## E. Environment variables (the full list)

Required:

    NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
    SUPABASE_SERVICE_ROLE_KEY=eyJ...
    SESSION_SECRET=<hex from step D>
    WALLET_MASTER_KEY=<64 hex chars from step D>
    CRON_SECRET=<hex from step D>

Strongly recommended:

    NEXT_PUBLIC_APP_NAME=MemePump
    NEXT_PUBLIC_APP_URL=https://your-real-domain.com
    SOLANA_RPC_URL=https://your-rpc-provider
    BOOTSTRAP_ADMIN_WALLET=<your Phantom address>

About `NEXT_PUBLIC_APP_URL`: the app now detects its own domain from incoming
requests, so cron URLs and Telegram links work with this unset. Set it anyway to
pin ONE canonical domain - otherwise links may use whichever hostname the
request arrived on (e.g. a preview URL).

Email (needed for admin email login + alerts):

    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=587
    SMTP_USER=you@gmail.com
    SMTP_PASS=<app password, NOT your login password>
    SMTP_FROM="MemePump <you@gmail.com>"
    SMTP_SECURE=false

Gmail requires an App Password (Google Account -> Security -> 2-Step
Verification -> App passwords). Port 587 = `SMTP_SECURE=false`, port 465 = `true`.

Admin login hardening (strongly recommended - see section J2):

    ADMIN_LOGIN_PATH=k7x-control-9f2
    ADMIN_LOGIN_EMAILS=you@gmail.com

`ADMIN_LOGIN_PATH` moves the login page off the guessable `/signin`.
`ADMIN_LOGIN_EMAILS` is a hard allowlist of who may even request a code.
These can also be set in the admin panel, which overrides env.

OPTIONAL feature keys (each unlocks one feature; app works without them):

    HELIUS_API_KEY=          # better RPC + holder data
    BIRDEYE_API_KEY=         # extra market data
    X_BEARER_TOKEN=          # social mentions (paid API)
    GEMINI_API_KEY=          # AI commentary
    TELEGRAM_BOT_TOKEN=      # Telegram signal alerts
    TELEGRAM_CHAT_ID=        # channel/group to post into
    AUTO_BUY_SIGNER_KEY=     # only if you enable auto-buy

Local development: put all of the above in a file named `.env.local` in the
project root. It is gitignored. Never commit it.

---

## F. Deploy on Vercel (recommended path)

1. vercel.com -> Add New -> Project -> Import your GitHub repo.
2. Framework preset: **Next.js** (auto-detected). Leave build command and output
   directory at defaults. Do not override them.
3. Expand **Environment Variables** and add every variable from section E.
   Select all three environments (Production, Preview, Development).
4. Click Deploy. First build takes 1-3 minutes.
5. If the build fails, read the FIRST error only - Next.js stops at the first
   type error, so later errors in the log are usually noise. Fix, push, rebuild.
6. Custom domain: Project -> Settings -> Domains -> Add. Point your registrar's
   DNS at the records Vercel shows. Then update `NEXT_PUBLIC_APP_URL` to the new
   domain and redeploy.

**Changing env vars does NOT apply to the running site by itself.** After editing
any variable: Deployments -> latest -> `...` -> Redeploy.

If you hit a stale/cached error that you know you already fixed:
Deployments -> `...` -> Redeploy -> **uncheck "Use existing Build Cache"**.

### Vercel cron limitation (already handled)

Hobby plan allows cron **once per day** with +/-59 min precision, and a
more-frequent expression fails at deploy time. This project therefore ships
`vercel.json` with NO `crons` key on purpose - scheduling is external
(section H). Do not add one back.

---

## G. Deploy on cPanel (Node.js hosting)

Your host must offer "Setup Node.js App" (LiteSpeed/CloudLinux Passenger).
Pure static/PHP shared hosting CANNOT run this app - Next.js needs a Node
server for the API routes. If your cPanel has no Node option, use Vercel.

### G1. Build settings

Edit `next.config.mjs` and add `output: "standalone"`. This bundles only the
needed `node_modules` into `.next/standalone`, which keeps you under cPanel's
inode limits:

    const nextConfig = {
      output: "standalone",
      // ...keep whatever else is already in the file
    };

### G2. Upload and install

1. cPanel -> **Setup Node.js App** -> Create Application.
   - Node version: 20.x (or highest available, minimum 18.17)
   - Application mode: Production
   - Application root: `memepump`
   - Application URL: your domain
   - Application startup file: `server.js`
2. Upload the project into `/home/<user>/memepump` (File Manager, or git):

       cd ~/memepump
       git clone https://github.com/<you>/<repo>.git .

3. In the Node.js App panel, click **Add Variable** and enter every variable from
   section E. (cPanel does not read `.env.local` reliably; use the panel.)
4. Open **Terminal** in cPanel (or SSH) and activate the app's virtualenv - the
   exact `source` line is shown at the top of your Node.js App page:

       source /home/<user>/nodevenv/memepump/20/bin/activate
       cd ~/memepump
       npm install
       npm run build

5. Wire up the startup file. With `output: "standalone"`, copy the server into
   place after each build:

       cp -r .next/standalone/. ./
       cp -r .next/static .next/standalone/.next/static 2>/dev/null || true
       cp -r public .next/standalone/public 2>/dev/null || true

   That produces a `server.js` in the app root, which is what you set as the
   startup file.

   Simpler alternative (no standalone): set the startup file to a small
   `server.js` you create yourself:

       const { createServer } = require("http");
       const next = require("next");
       const port = process.env.PORT || 3000;
       const app = next({ dev: false });
       const handle = app.getRequestHandler();
       app.prepare().then(() => {
         createServer((req, res) => handle(req, res)).listen(port);
       });

6. Back in the Node.js App page, click **Restart**.

### G3. HTTPS and proxying

- Enable **AutoSSL** (cPanel -> SSL/TLS Status) so your domain is https.
- Passenger normally proxies the domain to the Node app automatically. If you
  see the default cPanel page instead of the app, add to `public_html/.htaccess`:

      RewriteEngine On
      RewriteRule ^(.*)$ http://127.0.0.1:3000/$1 [P,L]

- The app reads `x-forwarded-host` and `x-forwarded-proto`, which cPanel/Apache
  set for you, so cron URLs and email/Telegram links will show your real cPanel
  domain automatically - no code change needed when migrating from Vercel.

### G4. Redeploying on cPanel

    source /home/<user>/nodevenv/memepump/20/bin/activate
    cd ~/memepump
    git pull
    npm install
    npm run build
    # then click Restart in the Node.js App page

---

## H. Scheduled jobs (cron-job.org) - REQUIRED

Without this, signals never refresh, alerts never fire, and orders never execute.
The site will look alive but do nothing on a schedule.

1. Sign in to the admin panel -> **Automation** tab. It lists every job with the
   exact URL and cron expression, built from the domain you are browsing, plus a
   Copy button.
2. At cron-job.org create ONE job per row below.
   - Method: GET
   - Header: `Authorization: Bearer <your CRON_SECRET>`
     (or append `?key=<CRON_SECRET>` to the URL if headers are awkward)
   - Enable failure notifications so you hear about outages.

| Job | Path | Every | Cron |
|---|---|---|---|
| Price alerts | `/api/cron/price-alerts` | 5 min | `*/5 * * * *` |
| Order keeper | `/api/cron/keeper` | 5 min | `*/5 * * * *` |
| Whale signals | `/api/cron/whale-signals` | 10 min | `*/10 * * * *` |
| Copy trade | `/api/cron/copytrade` | 10 min | `*/10 * * * *` |
| Signal scanner | `/api/cron/scan` | 15 min | `*/15 * * * *` |
| Signal follow-ups | `/api/cron/signal-updates` | 15 min | `*/15 * * * *` |
| User auto-trade | `/api/cron/user-autotrade` | 15 min | `*/15 * * * *` |
| Outcome tracking | `/api/cron/outcomes` | 30 min | `*/30 * * * *` |
| Holder snapshots | `/api/cron/holders` | 60 min | `0 * * * *` |

That is **9 jobs**. Free cron-job.org allows more than enough.

3. Verify: the Automation tab records every run (start, duration, status, error).
   A job is flagged **overdue** at 2.5x its cadence. If everything says overdue,
   your `CRON_SECRET` does not match - the endpoints return 401 and stay closed.
   They are never open: if `CRON_SECRET` is unset, all cron routes refuse.

Test one by hand:

    curl -i -H "Authorization: Bearer <CRON_SECRET>" https://your-domain/api/cron/scan

Expect HTTP 200 and a JSON envelope. 401 = wrong secret. 500 = read the message.

---

## I. First sign-in and becoming the owner

1. Open your deployed site.
2. Click **Connect Wallet** and approve the signature request (it is a plain
   message signature - it costs nothing and cannot move funds).
3. **The first account that ever signs in becomes the permanent OWNER.** Do this
   yourself, immediately after deploying, before sharing the URL with anyone.
   Setting `BOOTSTRAP_ADMIN_WALLET` to your address makes this deterministic.
4. Roles rank: `viewer` < `trader` < `admin` < `owner`. Admin panel needs
   `admin` or above.

---

## J. How admin login works (and the email fallback)

There are two ways in, and email is deliberately hidden from the public UI.

**Primary - wallet:** Connect Wallet with the owner/admin wallet. An `Admin` link
appears in the nav once your session is recognised as admin.

**Fallback - emailed code (admin only):** For when you are on a device without
your wallet.

- There is **no Email link anywhere on the homepage or nav**, by design. Regular
  users cannot use it, and advertising it just points attackers at the admin door.
- Go to **`/admin`**. If you are not signed in as an admin, you are forwarded to
  the sign-in page automatically. That is the only entry point.
- Enter your admin email -> receive a 6-digit code -> enter it -> you land in
  `/admin`.

Set this up BEFORE you need it, because it has three preconditions:

1. Your account must already have an email saved. Set it in **Admin panel ->
   Email -> "Admin login email"** (it saves to your own admin account). The
   Account page field works too - it is the same address.
2. Your account must already hold `admin` or `owner`.
3. SMTP must work - send the test email from the admin panel once to confirm.

### J2. Choosing your own admin login URL (and locking the form down)

By default the login form is at `/signin`. That name is guessable, so anyone can
load it and type random addresses. Two env vars fix that.

**1. Move the door.** Set `ADMIN_LOGIN_PATH` to anything unguessable:

    ADMIN_LOGIN_PATH=k7x-control-9f2

After redeploying:

| URL | Result |
|---|---|
| `https://your-site.com/k7x-control-9f2` | the login form |
| `https://your-site.com/signin` | **404 Not found** |
| `/admin` (no session) | says a private URL exists, but never reveals it |

Rules: no slashes or spaces, case-insensitive, trailing slashes cannot bypass it.
Change it any time by editing the var and redeploying - nothing in the database
moves. Bookmark the URL, because the app will never show it to you.

**2. Allowlist who may request a code.** This is the part that stops strangers
submitting random addresses:

    ADMIN_LOGIN_EMAILS=you@gmail.com,partner@company.com

Any address not on the list is rejected before a single database query or email
is sent. Leave it unset and the form still only ever emails real admin accounts,
but it will accept any typed address for processing.

**Why the form does not say "wrong email".** It deliberately answers identically
for a real admin address and a random one. A form that says "no such admin" is an
admin-discovery tool - an attacker submits a list of addresses and learns which
one owns your site, then targets that inbox. Instead the code screen explains the
three reasons nothing arrived (typo, spam folder, SMTP not working). Real errors
(invalid format, rate limited, SMTP failure) *are* still reported clearly.

**Defence in depth.** Knowing the URL is not access. An attacker still needs an
account that already exists AND already holds admin/owner, to be on the
allowlist, and to read the 6-digit code from your inbox within 10 minutes.

Guardrails: code expires in 10 minutes, 5 wrong attempts burns it, max 5 codes
per hour, and requests are rate limited (5 per 15 min). The response is identical
whether or not the email exists, so nobody can enumerate admin addresses.

**Locked out completely?** Set `BOOTSTRAP_ADMIN_WALLET` to a wallet you control
and sign in with it, or promote yourself directly in Supabase:

    update app_users set role = 'owner', is_admin = true
    where wallet_address = '<your wallet>';

---

## K. Post-deploy configuration checklist

In the admin panel:

- **Branding**: app name, logo URL, favicon URL, logo height, accent colour.
  Logo appears top-left in the navbar (DexScreener style). Changes show after a
  refresh.
- **Email**: set the **From name** (what recipients see in their inbox) and the
  **From address**, save your **Admin login email**, then **send the test email**.
  Do not skip this - it
  is what proves your admin fallback login will work.
- **Automation**: copy the 9 cron URLs (section H).
- **Ads**: enable, then add creatives per slot (`top_banner`, `sidebar`,
  `scanner_inline`, `token_page`, `footer`). Impressions and clicks are counted.
- **Signals**: min confidence, min liquidity, safety score gate.
- **Wallet limits**: max per withdrawal (default 5 SOL), 24h cap (default 10),
  optional email confirmation, optional address allowlist.
- **Telegram**: bot token, chat id, and the buy route (Jupiter / BonkBot /
  Trojan / GMGN / custom).

---

## L. Verifying the deployment actually works

Work through these in order; each failure has a specific cause.

| Check | Expect | If it fails |
|---|---|---|
| Homepage loads, token rows appear | scanner list | Supabase env wrong, or DexScreener rate limit |
| Logo/name correct | your branding | re-save Branding, hard refresh |
| Connect Wallet | wallet short address in navbar | Phantom not installed; check browser console |
| `/admin` while signed out | forwarded to sign-in | fine - this is intended |
| Admin panel opens as owner | 8 tabs | you are not admin; see section J |
| Test email arrives | inbox | SMTP wrong; Gmail needs App Password |
| `curl` a cron URL with the secret | HTTP 200 | 401 = `CRON_SECRET` mismatch |
| Automation tab after ~20 min | recent runs, none overdue | cron-job.org header wrong |
| Token detail page | chart + txns + sidebar | check RPC / candle provider |
| Telegram alert buy button | opens the right app | set the buy route in admin |

---

## M. Common failures and exact fixes

**Build fails: `Type error: Property 'x' does not exist on type ...`**
A real type mismatch. Next.js stops at the first one. Fix that one line, push.

**Build fails: `has no exported member`**
An import references something that was renamed or a file lost content. Open the
file named in the error and check what it actually exports.

**Build succeeded but the site 500s on every page**
Missing env vars in production. Vercel: Settings -> Environment Variables, then
Redeploy. Env changes never apply to an already-built deployment.

**`relation "<table>" does not exist`**
`schema.sql` never fully ran. Run the WHOLE file (section C) and re-check the
count query.

**Everyone got signed out after deploying**
Expected once, when the session format changed. Sign in again.

**Cron URLs show the wrong domain**
Fixed in this build - URLs come from the request host now. If you still see a
stale domain, `NEXT_PUBLIC_APP_URL` is set to it; update or remove it.

**Telegram buy button does nothing**
Set the buy route in admin. The "Full analysis" button is omitted entirely when
the app has no publicly reachable URL yet, rather than shipping a broken link.

**cPanel: default page instead of the app**
Passenger is not proxying. Add the `.htaccess` rewrite in G3 and Restart.

**cPanel: `npm install` killed / out of memory**
Build locally, commit `.next`, or ask support to raise the memory limit. Use
`output: "standalone"` to cut the dependency footprint.

---

## N. Security notes worth knowing

- Sessions are opaque 64-hex tokens; only a SHA-256 hash is stored. Cookie is
  `httpOnly`, `secure`, `sameSite=lax`, 7-day expiry. Revocable per device from
  Account.
- Row-level security is enabled on all 23 tables. Only the service_role key
  bypasses it, and that key never reaches the browser.
- Rate limits are enforced in Postgres (survives restarts, shared across
  instances): auth email 5/15min, verify 10/15min, wallet withdraw 10/hour,
  public data endpoints 30-120/min.
- Withdrawals: per-transaction cap, rolling 24h cap, optional allowlist,
  optional emailed confirmation. Limit checks **fail closed** - if the DB is
  unreachable, the withdrawal is refused rather than allowed.
- Custodial keys use per-user HKDF-derived keys from `WALLET_MASTER_KEY`, so one
  leaked derived key does not expose other users.
- All input is validated with zod schemas before touching the database.

---

## O. Going live checklist

- [ ] Whole `supabase/schema.sql` run; count query returns 13
- [ ] All required env vars set in the host (not just locally)
- [ ] `WALLET_MASTER_KEY` backed up in a password manager
- [ ] You signed in first and hold the owner role
- [ ] Admin email saved on your account + test email received
- [ ] All 9 cron-job.org jobs created with the auth header
- [ ] Automation tab shows recent runs, nothing overdue
- [ ] Branding (logo + favicon) set
- [ ] Withdrawal caps reviewed
- [ ] Custom domain + HTTPS working
- [ ] `NEXT_PUBLIC_APP_URL` set to the final domain, then redeployed


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
