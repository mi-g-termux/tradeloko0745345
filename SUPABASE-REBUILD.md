# Supabase Rebuild \u2014 Fresh Start Guide

Use this when you have lost access to your Supabase project and need to stand up
a new backend from zero. Nothing in the codebase is hardcoded to a Supabase
project, so this is a configuration change only \u2014 no code edits are required.

---

## 0. Before you rebuild: two minutes that could save you hours

A ban, a network block and a known dashboard bug all look identical from the
login page. Rule out the cheap explanations first:

- [ ] Try a different browser, and an incognito window
- [ ] Try a different network (mobile data instead of wifi, or a VPN)
- [ ] Try your original sign-in provider (GitHub / Google) rather than email
- [ ] Password reset at `https://supabase.com/dashboard/sign-in`
- [ ] If the org has another Owner, ask them to re-invite you

If the account is genuinely banned, email **support@supabase.com** from the
banned address and ask three separate questions: the reason, whether an appeal
exists, and **whether they will allow a one-time data export even if the ban
stands**. That last one matters most \u2014 see the warning in step 6.

---

## 1. Create the new project

1. Sign up with a **real, permanent email**. Disposable-domain signups
   (`maildrop.cc`, `10minutemail`, etc.) are the most common cause of automatic
   bans.
2. **Enable 2FA immediately.**
3. New project \u2192 pick a region close to your users \u2192 save the database password
   somewhere safe. You will not be shown it again.

> If this project will hold user funds, do not stay on the Free plan. Free has
> no backups at all, pauses after one week of inactivity, and gives you no
> support channel \u2014 which is exactly the situation that led you here.

---

## 2. Run the schema

SQL Editor \u2192 New query \u2192 paste the **entire** contents of `supabase/schema.sql`
\u2192 Run.

Run the whole file in one execution. Do not split it into pieces: the script
creates the `pgcrypto` extension first, then `app_users`, and twelve other
tables carry foreign keys back to `app_users`. Running fragments out of order
will fail.

The script is fully idempotent (`create table if not exists` throughout), so it
is safe to re-run if something goes wrong partway.

### Verify it worked

```sql
select count(*) as tables
from pg_tables
where schemaname = 'public';
```

Expect **23**.

Then confirm the tables that were added in later versions actually exist \u2014 these
are the ones that have caused "relation does not exist" errors before:

```sql
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in (
    'site_ads',
    'user_sessions',
    'rate_hits',
    'withdraw_confirmations'
  )
order by tablename;
```

Expect **4 rows**. If you get fewer, the script did not finish \u2014 scroll up in the
SQL editor output to find the first error and re-run the whole file.

Confirm Row Level Security is on:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

Every row should show `rowsecurity = true`.

---

## 3. Collect the new credentials

Settings \u2192 API:

| Dashboard field | Environment variable |
| --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` |

**Never expose the `service_role` key to the browser.** It bypasses Row Level
Security entirely. It belongs only in server-side environment variables \u2014 note
that it has no `NEXT_PUBLIC_` prefix, and that is deliberate.

---

## 4. Update environment variables

### Vercel

Settings \u2192 Environment Variables \u2192 edit each of the three \u2192 tick **Production,
Preview and Development**.

### cPanel / VPS / Docker

Edit `.env` (or your Node app's environment panel) and restart the process:

```bash
pm2 restart memepump --update-env
```

---

## 5. Set the admin bootstrap BEFORE anyone visits

A fresh database has no users, which means **the ownership row is unclaimed**.
Set this in the same deploy:

```
BOOTSTRAP_ADMIN_WALLET=<your wallet address>
```

Without it, the first person to connect a wallet can take ownership of the admin
panel. Set it before the site is reachable, not after.

If you also use email login for admin:

```
ADMIN_LOGIN_EMAILS=you@yourdomain.com
ADMIN_LOGIN_PATH=<your private admin door>
```

Set `ADMIN_LOGIN_PATH` only **after** you have confirmed wallet login works, so
you cannot lock yourself out of both doors at once.

---

## 6. Redeploy with the build cache cleared

Vercel \u2192 Deployments \u2192 \u22ef \u2192 Redeploy \u2192 **uncheck "Use existing Build Cache"**.

This step is not optional. `NEXT_PUBLIC_*` variables are compiled into the
client bundle at build time, so a cached build will keep pointing at the dead
project no matter what you changed in the dashboard.

---

## \u26a0\ufe0f What you cannot recover

**Custodial wallet funds are gone.** The `user_wallets` table stored each user's
encrypted private key in `secret_enc`. `WALLET_MASTER_KEY` was only the key that
*decrypts* those blobs \u2014 the blobs themselves lived in the database. A new empty
database means those keys no longer exist anywhere, and any SOL held in those
wallets is permanently unreachable.

There is no workaround for this. It is the reason step 0 is worth doing
properly, and the reason to ask Supabase for a data export even if they refuse
to lift the ban. A single `pg_dump` of the old project would recover it.

If users held real funds, tell them plainly and quickly.

---

## 7. Reconfigure the admin panel

`admin_config` lives in the database, so every panel setting is back to
defaults. Work through the tabs:

**Branding** \u2014 logo URL, favicon, brand name, logo height, accent colour

**Providers** \u2014 and set **Public site URL** first. If you skip it, Telegram
signal buttons fall back to whatever rotating Vercel preview domain issued the
build, which is the cause of those unusable `memepumps-f54lx2t2g-...` links.

API keys to re-enter: Helius, Birdeye, X bearer token, Gemini, OpenAI,
Anthropic, Groq, DeepSeek, plus the backup RPC URL.

**Automation** \u2014 re-enable the scanner, keeper, whale tracking, launch feed, AI
analysis and copy-trade toggles

**Alerts** \u2014 SMTP host, port, user, password, From address and From name;
Telegram bot token and chat ID

**Signals** \u2014 minimum confidence, minimum liquidity, required safety score

**Ads** \u2014 recreate slots: `top_banner`, `sidebar`, `scanner_inline`,
`token_page`, `footer`

**Trading** \u2014 slippage, fee percent, per-user buy and daily caps

---

## 8. Rotate your secrets

Treat anything that touched the compromised account as burned:

```bash
openssl rand -hex 32   # WALLET_MASTER_KEY
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # CRON_SECRET
```

Changing `SESSION_SECRET` signs every user out once. That is expected and
correct \u2014 old session tokens should not survive a backend migration.

If you change `CRON_SECRET`, update all **9** cron-job.org entries to match, or
every scheduled job will start returning 401. The app denies cron requests when
the secret is unset, by design.

---

## 9. Final checklist

- [ ] 23 tables present, RLS on for all of them
- [ ] Three Supabase env vars updated in all environments
- [ ] `BOOTSTRAP_ADMIN_WALLET` set before the site went live
- [ ] Redeployed with the build cache cleared
- [ ] Admin panel reachable, and you own it
- [ ] Public site URL set in Providers
- [ ] Telegram test signal produces a link on your real domain
- [ ] All 9 cron-job.org entries returning 200
- [ ] Secrets rotated

### Data that rebuilds itself

Signal history, holder snapshots, safety cache, whale alerts and token searches
all repopulate automatically once the cron jobs run. Watchlists, price alerts
and per-user trade settings do not \u2014 those were user-entered and are gone.


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
