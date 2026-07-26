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
