# MemePump - Deploy On Every Platform

One file, every hosting option, exact commands.

- `DEPLOY.md` = the full A-Z first-time setup (database, secrets, cron, admin login).
- **This file** = the platform-specific half. Pick your platform, follow that section.

**Do section C (database) and D (secrets) of `DEPLOY.md` first.** No platform works
without the schema and env vars, and nothing below repeats those steps.

---

## 0. Which platform should you pick?

| Platform | Works? | Difficulty | Cost floor | Notes |
|---|---|---|---|---|
| **Vercel** | perfect | easiest | free | built for Next.js. Cron limited on free (use cron-job.org) |
| **Render** | perfect | easy | free tier sleeps | free instance cold-starts; $7/mo to stay awake |
| **Railway** | perfect | easy | ~$5/mo | very smooth Docker/Nixpacks |
| **Fly.io** | perfect | medium | ~$3/mo | global, real Docker |
| **DigitalOcean App Platform** | perfect | easy | ~$5/mo | Dockerfile auto-detected |
| **Google Cloud Run** | perfect | medium | pay-per-use | scales to zero, generous free tier |
| **VPS + Nginx + PM2** | perfect | hardest | ~$4/mo | full control, you patch the server |
| **Docker / Compose** | perfect | medium | your host | runs anywhere |
| **Coolify / Dokploy** | perfect | medium | your VPS | self-hosted Vercel-like |
| **cPanel (Node.js app)** | works | medium | shared price | needs "Setup Node.js App" |
| **Plesk (Node.js)** | works | medium | shared price | same idea as cPanel |
| **Netlify** | works | easy | free | needs the Next runtime plugin |
| **AWS Amplify** | works | medium | pay-per-use | pick the SSR/Next preset |
| **Azure App Service** | works | medium | ~$13/mo | Linux plan only |
| **Heroku** | works | easy | ~$5/mo | no free tier anymore |
| **Cloudflare Pages/Workers** | NOT supported | - | - | see section 15 - do not try |
| **Plain PHP shared hosting** | NOT possible | - | - | no Node = no API routes |

Everything marked "perfect" or "works" runs the identical codebase. No forks.

### Two things every platform needs

1. **`NEXT_PUBLIC_*` vars are baked in at BUILD time.** Setting them only at
   runtime leaves the browser bundle with empty values and the site half-broken.
   On Docker-based platforms pass them as build args.
2. **Cron is always external** (cron-job.org, section H of `DEPLOY.md`). Nine jobs.
   The app never relies on platform schedulers, so it behaves the same everywhere.

---

## 1. Vercel

    1. vercel.com -> Add New -> Project -> import your GitHub repo
    2. Preset: Next.js (auto). Do not override build/output settings.
    3. Add every env var from DEPLOY.md section E (all 3 environments)
    4. Deploy

- Do **not** set `BUILD_STANDALONE`. Vercel supplies its own server layer.
- Custom domain: Settings -> Domains, then set `NEXT_PUBLIC_APP_URL` and redeploy.
- Env var changes need a redeploy: Deployments -> `...` -> Redeploy.
- Stale error you already fixed? Redeploy with **"Use existing Build Cache" unchecked**.
- Hobby cron = once/day only, so `vercel.json` intentionally has no `crons` key.

---

## 2. Render

Web Service, no Docker needed.

    1. render.com -> New -> Web Service -> connect repo
    2. Runtime:       Node
       Build command: npm ci && npm run build
       Start command: npm run start
       Instance:      Free (sleeps) or Starter ($7, stays awake)
    3. Environment -> add all vars from DEPLOY.md section E
    4. Create Web Service

- Render sets `PORT` itself; `npm run start` honours it. Do not hardcode 3000.
- **Free tier sleeps after ~15 min idle.** First request then takes ~50s. Your
  cron-job.org calls will wake it, but they may time out on the cold hit - set
  cron-job.org's timeout to 30s+ and enable retries, or use Starter.
- Prefer Docker? Set runtime to Docker; the included `Dockerfile` is detected and
  you must add the `NEXT_PUBLIC_*` values as **build args** too.

---

## 3. Railway

    1. railway.app -> New Project -> Deploy from GitHub repo
    2. Railway auto-detects Next.js (Nixpacks) and runs build + start
    3. Variables tab -> paste all env vars (it accepts bulk .env paste)
    4. Settings -> Networking -> Generate Domain

- Railway injects `PORT`; the default start command respects it.
- To use the Dockerfile instead: Settings -> Build -> Builder = Dockerfile.
- Bulk-paste is the fastest way to load section E - use the "Raw editor".

---

## 4. Fly.io

Uses the included `Dockerfile`.

    # one-time
    curl -L https://fly.io/install.sh | sh
    fly auth login

    cd your-project
    fly launch --no-deploy      # accept Dockerfile, pick region, say NO to a Postgres db

Edit the generated `fly.toml` so the internal port matches:

    [http_service]
      internal_port = 3000
      force_https = true
      auto_stop_machines = "stop"
      auto_start_machines = true
      min_machines_running = 0

Set secrets (runtime) and build args (browser bundle):

    fly secrets set \
      SUPABASE_SERVICE_ROLE_KEY=... \
      SESSION_SECRET=... \
      WALLET_MASTER_KEY=... \
      CRON_SECRET=... \
      SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... SMTP_FROM="MemePump <you@x.com>"

    fly deploy \
      --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
      --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
      --build-arg NEXT_PUBLIC_APP_URL=https://your-app.fly.dev \
      --build-arg NEXT_PUBLIC_APP_NAME=MemePump

- `auto_stop_machines` saves money but cold-starts; your 5-minute cron keeps it warm.
- Custom domain: `fly certs add your-domain.com`, then point DNS at Fly.

---

## 5. DigitalOcean App Platform

    1. cloud.digitalocean.com -> Apps -> Create App -> GitHub repo
    2. Resource type: Web Service. It detects the Dockerfile automatically.
       (No Docker? Build: npm ci && npm run build   Run: npm run start)
    3. Settings -> App-Level Environment Variables -> add section E
       Mark secrets as "Encrypted"
    4. HTTP port: 3000
    5. Deploy

- If using the Dockerfile, add the `NEXT_PUBLIC_*` pairs as **build-time** args too.
- Free static hosting will NOT work here - this app needs the Web Service type.

---

## 6. Google Cloud Run

Scales to zero, very cheap.

    gcloud auth login
    gcloud config set project YOUR_PROJECT_ID

    # build the image (NEXT_PUBLIC_* must be build args)
    gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/memepump \
      --substitutions=_URL=https://xxx.supabase.co

Simplest reliable path is a local build and push:

    docker build \
      --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
      --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
      --build-arg NEXT_PUBLIC_APP_URL=https://your-service-url \
      -t gcr.io/YOUR_PROJECT_ID/memepump .

    docker push gcr.io/YOUR_PROJECT_ID/memepump

    gcloud run deploy memepump \
      --image gcr.io/YOUR_PROJECT_ID/memepump \
      --platform managed --region us-central1 \
      --allow-unauthenticated --port 3000 \
      --set-env-vars "SUPABASE_SERVICE_ROLE_KEY=...,SESSION_SECRET=...,WALLET_MASTER_KEY=...,CRON_SECRET=..."

- Use Secret Manager for real secrets: `--set-secrets WALLET_MASTER_KEY=wmk:latest`.
- The Dockerfile already binds `0.0.0.0` and honours `PORT`, which Cloud Run requires.
- Chicken-and-egg on the URL: deploy once, copy the service URL, rebuild with it
  as `NEXT_PUBLIC_APP_URL`. Or skip it - the app auto-detects its host.

---

## 7. VPS (Ubuntu 22.04/24.04) + Nginx + PM2

The most control. ~15 minutes.

### 7.1 Server prep

    ssh root@YOUR_SERVER_IP
    apt update && apt upgrade -y

    # Node 20
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs git nginx
    npm install -g pm2

    adduser --disabled-password --gecos "" memepump
    su - memepump

### 7.2 App

    git clone https://github.com/<you>/<repo>.git ~/app
    cd ~/app
    npm ci

    # secrets, owned by this user only
    nano .env.production        # paste every var from DEPLOY.md section E
    chmod 600 .env.production
    set -a && . ./.env.production && set +a

    BUILD_STANDALONE=1 npm run build
    mkdir -p logs
    cp -r public .next/standalone/public
    cp -r .next/static .next/standalone/.next/static

    pm2 start ecosystem.config.js
    pm2 save
    exit

    # as root, make PM2 boot with the server
    pm2 startup systemd -u memepump --hp /home/memepump

### 7.3 Nginx reverse proxy

`/etc/nginx/sites-available/memepump`:

    server {
      listen 80;
      server_name your-domain.com www.your-domain.com;
      client_max_body_size 10M;

      location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_cache_bypass $http_upgrade;
      }
    }

The `X-Forwarded-Proto` and `X-Forwarded-Host` lines are not optional - the app
reads them to build correct cron URLs and email/Telegram links.

    ln -s /etc/nginx/sites-available/memepump /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx

### 7.4 HTTPS + firewall

    apt install -y certbot python3-certbot-nginx
    certbot --nginx -d your-domain.com -d www.your-domain.com   # auto-renews

    ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable

### 7.5 Redeploy later

    su - memepump && cd ~/app
    git pull
    npm ci
    set -a && . ./.env.production && set +a
    BUILD_STANDALONE=1 npm run build
    cp -r public .next/standalone/public
    cp -r .next/static .next/standalone/.next/static
    pm2 restart memepump

Useful: `pm2 logs memepump`, `pm2 monit`, `pm2 status`.

---

## 8. Docker / Docker Compose (any host)

Files included: `Dockerfile`, `.dockerignore`, `docker-compose.yml`.

    cp .env.example .env 2>/dev/null || nano .env    # fill in section E values
    docker compose up -d --build

    docker compose logs -f app        # watch
    docker compose restart app
    docker compose down              # stop

Update after a code change:

    git pull && docker compose up -d --build

Plain Docker without compose:

    docker build \
      --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
      --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
      --build-arg NEXT_PUBLIC_APP_URL=https://your-domain.com \
      -t memepump .

    docker run -d --name memepump -p 3000:3000 --restart unless-stopped \
      --env-file .env memepump

Put Nginx (section 7.3) or Caddy in front for HTTPS. Caddy is two lines:

    your-domain.com {
      reverse_proxy 127.0.0.1:3000
    }

---

## 9. Coolify / Dokploy (self-hosted, Vercel-like)

    1. Install Coolify on a VPS:  curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
    2. New Resource -> Application -> your Git repo
    3. Build pack: Dockerfile
    4. Port: 3000
    5. Environment Variables -> paste section E
       tick "Build Variable" on every NEXT_PUBLIC_* entry
    6. Set the domain; Coolify issues Let's Encrypt automatically
    7. Deploy

Gives you push-to-deploy and auto-HTTPS on hardware you own.

---

## 10. cPanel (Node.js hosting)

Requires **Setup Node.js App** (CloudLinux/Passenger). See `DEPLOY.md` section G
for the full walkthrough. Condensed:

    1. Setup Node.js App -> Create:
         Node 20, Production, root=memepump, startup file=server.js
    2. Upload/clone the code into /home/<user>/memepump
    3. Add every env var in the panel, plus BUILD_STANDALONE=1
    4. Terminal:
         source /home/<user>/nodevenv/memepump/20/bin/activate
         cd ~/memepump && npm install
         BUILD_STANDALONE=1 npm run build
         cp -r .next/standalone/. ./
         cp -r .next/static .next/standalone/.next/static
         cp -r public .next/standalone/public
    5. Restart the app in the panel
    6. Enable AutoSSL

If you get the default cPanel page, add to `public_html/.htaccess`:

    RewriteEngine On
    RewriteRule ^(.*)$ http://127.0.0.1:3000/$1 [P,L]

`npm install` killed for memory? Build locally and upload `.next`, or use
standalone (already the smallest option) and ask support to raise the limit.

---

## 11. Plesk

    1. Install the "Node.js" Plesk extension
    2. Domains -> your domain -> Node.js -> Enable
    3. Application root: the uploaded project folder
       Application startup file: .next/standalone/server.js
       Application mode: production
    4. Add env vars in the Node.js panel (include BUILD_STANDALONE=1)
    5. NPM install, then Run script -> build
    6. Restart App
    7. Let's Encrypt from the SSL/TLS Certificates page

Plesk proxies through Nginx/Apache and sets the forwarded headers, so URL
detection works with no extra config.

---

## 12. Netlify

Works, but Next.js SSR on Netlify is a runtime shim rather than a first-class
target - Vercel or Render is smoother.

    1. netlify.com -> Add new site -> Import from Git
    2. Build command: npm run build
       Publish directory: .next
    3. Netlify auto-installs @netlify/plugin-nextjs. If it does not, add netlify.toml:

         [build]
           command = "npm run build"
           publish = ".next"

         [[plugins]]
           package = "@netlify/plugin-nextjs"

    4. Site settings -> Environment variables -> add section E
    5. Deploy

- Do **not** set `BUILD_STANDALONE`.
- Functions time out at 10s on the free plan; the heavier cron jobs (`scan`) can
  exceed that. If they do, run cron against a Vercel/Render deployment, or upgrade.

---

## 13. AWS Amplify Hosting

    1. Amplify Console -> Host web app -> connect GitHub
    2. Amplify detects Next.js SSR. Accept the generated amplify.yml:

         version: 1
         frontend:
           phases:
             preBuild:
               commands: ["npm ci"]
             build:
               commands: ["npm run build"]
           artifacts:
             baseDirectory: .next
             files: ["**/*"]
           cache:
             paths: ["node_modules/**/*"]

    3. App settings -> Environment variables -> add section E
    4. Save and deploy

Ensure the platform is **WEB_COMPUTE** (SSR), not static hosting, or the API
routes 404. Alternative: run the Docker image on ECS Fargate or App Runner.

---

## 14. Azure App Service / Heroku

**Azure (Linux plan only):**

    az webapp up --runtime "NODE:20-lts" --sku B1 --name your-app-name
    az webapp config appsettings set --name your-app-name --resource-group <rg> \
      --settings SESSION_SECRET=... WALLET_MASTER_KEY=... CRON_SECRET=...
    az webapp config set --name your-app-name --resource-group <rg> \
      --startup-file "npm run start"

Set `SCM_DO_BUILD_DURING_DEPLOYMENT=true` so Azure builds on deploy.

**Heroku:**

    heroku create your-app-name
    heroku config:set SESSION_SECRET=... WALLET_MASTER_KEY=... CRON_SECRET=... \
      NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
      SUPABASE_SERVICE_ROLE_KEY=...
    git push heroku main

Heroku's Node buildpack runs `npm run build` then `npm run start`, and injects
`PORT`. No Procfile needed. Dynos restart daily - harmless here, since all state
lives in Supabase.

---

## 15. Cloudflare Pages / Workers - NOT supported

Do not spend hours on this. The app cannot run on the Workers runtime:

- `src/lib/wallet/crypto.ts` uses Node `crypto` (scrypt, HKDF) for wallet key
  derivation. Workers has WebCrypto, which has no scrypt.
- `nodemailer` needs raw TCP sockets for SMTP. Workers cannot open them.
- `@solana/web3.js` pulls in Node buffer/stream internals.

You would have to rip out custodial wallets and all email. Use Cloudflare for DNS
and CDN in front of any platform above - that part works great.

Same verdict, different reason, for **plain PHP/static shared hosting** (no Node
process at all) and **GitHub Pages / S3 / Netlify Drop** (static only - the 40+
API routes simply will not exist).

---

## 16. After deploying anywhere - the same 6 steps

1. Open the site. It should load with token rows.
2. **Connect Wallet immediately.** First sign-in = permanent owner.
3. Go to `/admin` (the only entry to admin sign-in - no public link exists).
4. Set Branding, then SMTP, and **send the test email**.
5. Automation tab -> copy the 9 cron URLs -> create the jobs at cron-job.org with
   header `Authorization: Bearer <CRON_SECRET>`.
6. Wait ~20 min, re-check Automation. Recent runs, nothing overdue.

Quick smoke test from your machine:

    curl -sI https://your-domain/                       # 200
    curl -s  https://your-domain/api/branding           # JSON
    curl -sI https://your-domain/api/cron/scan          # 401 without the secret (correct)
    curl -s -H "Authorization: Bearer <CRON_SECRET>" https://your-domain/api/cron/scan   # 200

---

## 17. Platform-independent troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build: `Property 'x' does not exist` | real type error | fix that line, push |
| Build: `has no exported member` | renamed/missing export | check the file's exports |
| Site 500s everywhere | env vars missing in prod | add them, then REDEPLOY |
| Supabase errors, empty pages | schema never ran | run whole `supabase/schema.sql` |
| `relation "..." does not exist` | partial schema paste | run the whole file |
| Blank page, console: supabase undefined | `NEXT_PUBLIC_*` missing at build | rebuild with build args |
| Cron URLs show wrong domain | `NEXT_PUBLIC_APP_URL` pinned wrong | update or unset it |
| All cron jobs 401 | `CRON_SECRET` mismatch | make header and env identical |
| All jobs overdue | cron-job.org not firing | check its logs, enable notifications |
| Test email fails | SMTP wrong | Gmail needs an App Password |
| Admin panel 403 | not admin | see `DEPLOY.md` section J |
| Everyone signed out once | session format changed | expected, sign in again |
| Platform health check fails | app not on 0.0.0.0 | Dockerfile already sets `HOSTNAME=0.0.0.0` |
| Port conflict | hardcoded 3000 | always honour `process.env.PORT` |
| Cold start timeouts | free tier sleeping | raise cron timeout, or paid tier |

---

## 18. Migrating between platforms

The app is portable by design. To move (e.g. Vercel -> cPanel):

1. Deploy to the new platform with the **same** env vars, above all the same
   `WALLET_MASTER_KEY` and `SESSION_SECRET`. Different key = custodial wallets
   cannot decrypt and every session is invalidated.
2. Point DNS at the new host.
3. Update `NEXT_PUBLIC_APP_URL` (or unset it and let auto-detection work).
4. **Edit the 9 cron-job.org URLs to the new domain.** Nothing else does this for
   you, and stale URLs keep hitting the old deployment.
5. Verify the Automation tab shows fresh runs, then decommission the old host.

The database does not move - it stays in Supabase and both hosts can talk to it,
so you can run them in parallel during the switchover with zero downtime.


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
