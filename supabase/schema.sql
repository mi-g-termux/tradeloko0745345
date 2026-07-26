-- ════════════════════════════════════════════════════════════════
-- Memecoin Radar — Supabase schema
-- Run this whole file in the Supabase SQL editor (or `supabase db push`).
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- App users. Auth via Solana wallet (SIWS) or Telegram. `role` drives access.
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique,
  telegram_id text unique,
  telegram_username text,
  telegram_chat_id text,          -- personal alerts destination
  display_name text,
  is_admin boolean not null default false,
  role text not null default 'viewer',   -- viewer | trader | admin | owner
  alerts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
alter table app_users add column if not exists telegram_chat_id text;
alter table app_users add column if not exists role text not null default 'viewer';
alter table app_users add column if not exists alerts_enabled boolean not null default false;

-- One-time nonces for the Sign-In-With-Solana challenge/response flow.
create table if not exists auth_nonces (
  nonce text primary key,
  wallet_address text,
  created_at timestamptz not null default now(),
  used boolean not null default false
);

-- Global admin configuration (single row, id = 1). Secrets are server-side only.
create table if not exists admin_config (
  id integer primary key default 1,
  auto_buy_enabled boolean not null default false,
  whale_tracking_enabled boolean not null default false,
  x_feed_enabled boolean not null default false,
  ai_enabled boolean not null default false,
  telegram_alerts_enabled boolean not null default false,
  auto_scan_enabled boolean not null default false,
  copy_trade_enabled boolean not null default false,
  launch_feed_enabled boolean not null default false,
  keeper_enabled boolean not null default false,
  helius_api_key text,
  birdeye_api_key text,
  x_bearer_token text,
  gemini_api_key text,
  telegram_bot_token text,
  telegram_chat_id text,
  rpc_url text,
  max_buy_sol numeric not null default 0.1,
  daily_spend_cap_sol numeric not null default 1.0,
  slippage_bps integer not null default 100,
  min_liquidity_usd numeric not null default 5000,
  require_safe_score integer not null default 60,
  min_signal_confidence integer not null default 55,
  updated_at timestamptz not null default now(),
  constraint admin_config_singleton check (id = 1)
);
insert into admin_config (id) values (1) on conflict (id) do nothing;

-- Additive columns for existing installs (idempotent).
alter table admin_config add column if not exists ai_enabled boolean not null default false;
alter table admin_config add column if not exists telegram_alerts_enabled boolean not null default false;
alter table admin_config add column if not exists auto_scan_enabled boolean not null default false;
alter table admin_config add column if not exists copy_trade_enabled boolean not null default false;
alter table admin_config add column if not exists launch_feed_enabled boolean not null default false;
alter table admin_config add column if not exists keeper_enabled boolean not null default false;
alter table admin_config add column if not exists gemini_api_key text;
alter table admin_config add column if not exists telegram_bot_token text;
alter table admin_config add column if not exists telegram_chat_id text;
alter table admin_config add column if not exists min_signal_confidence integer not null default 55;
-- v2.4: sender display name, so alerts arrive as `MemePump <alerts@site.com>`
-- instead of a bare address (which most inboxes treat as spam).
alter table admin_config add column if not exists smtp_from_name text;

-- Wallets a user tracks for copy-trade / whale watching.
create table if not exists tracked_wallets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_users(id) on delete cascade,
  address text not null,
  label text,
  copy_enabled boolean not null default false,   -- opt-in per-wallet copy trading
  created_at timestamptz not null default now(),
  unique (owner_id, address)
);
alter table tracked_wallets add column if not exists copy_enabled boolean not null default false;

-- User token watchlist (drives per-user Telegram alerts).
create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_users(id) on delete cascade,
  token_address text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (owner_id, token_address)
);

-- Record of buy orders (manual, auto, copy).
create table if not exists buy_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_users(id) on delete set null,
  token_address text not null,
  amount_sol numeric not null,
  status text not null default 'pending',
  tx_signature text,
  safety_score integer,
  source text,                 -- manual | auto | copy | keeper
  source_ref text,             -- e.g. originating whale tx signature (copy dedupe)
  error text,
  created_at timestamptz not null default now()
);
alter table buy_orders add column if not exists source_ref text;

-- Cached safety analyses.
create table if not exists safety_cache (
  token_address text primary key,
  score integer,
  data jsonb,
  updated_at timestamptz not null default now()
);

-- Signal history + outcome tracking (measured, honest performance).
create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  token_address text not null,
  symbol text,
  direction text,
  confidence integer,
  score integer,
  data jsonb,
  alerted boolean not null default false,
  price_at_signal numeric,
  price_1h numeric,
  price_24h numeric,
  return_1h numeric,
  return_24h numeric,
  outcome_checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists signals_token_time on signals (token_address, created_at desc);
alter table signals add column if not exists price_at_signal numeric;
alter table signals add column if not exists price_1h numeric;
alter table signals add column if not exists price_24h numeric;
alter table signals add column if not exists return_1h numeric;
alter table signals add column if not exists return_24h numeric;
alter table signals add column if not exists outcome_checked_at timestamptz;

-- Holder concentration snapshots over time (deeper safety trend).
create table if not exists holder_snapshots (
  id uuid primary key default gen_random_uuid(),
  token_address text not null,
  top_holder_pct numeric,
  top10_pct numeric,
  created_at timestamptz not null default now()
);
create index if not exists holder_snapshots_token_time on holder_snapshots (token_address, created_at desc);

-- Limit / take-profit / stop-loss orders executed by the keeper.
create table if not exists limit_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_users(id) on delete set null,
  token_address text not null,
  symbol text,
  side text not null,                 -- buy | sell
  trigger_type text not null,         -- price_below | price_above
  trigger_price numeric not null,
  amount_sol numeric,                 -- for buys
  status text not null default 'open',-- open | filled | cancelled | failed
  tx_signature text,
  error text,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);
create index if not exists limit_orders_status on limit_orders (status);

-- ════════════════════════════════════════════════════════════════
-- Email notifications (SMTP) + user-defined price-condition alerts
-- Additive + idempotent: safe to re-run on existing installs.
-- ════════════════════════════════════════════════════════════════

-- Per-user email + notification preferences.
alter table app_users add column if not exists email text;
alter table app_users add column if not exists notify_email_enabled boolean not null default false;
alter table app_users add column if not exists notify_on_buy boolean not null default true;
alter table app_users add column if not exists notify_on_sell boolean not null default true;

-- Admin SMTP settings (single admin_config row).
alter table admin_config add column if not exists email_notifications_enabled boolean not null default false;
alter table admin_config add column if not exists smtp_host text;
alter table admin_config add column if not exists smtp_port integer default 587;
alter table admin_config add column if not exists smtp_user text;
alter table admin_config add column if not exists smtp_pass text;
alter table admin_config add column if not exists smtp_from text;
alter table admin_config add column if not exists smtp_secure boolean not null default false;

-- User-defined price alerts: notify me when a token moves up (e.g. 2x = +100%)
-- or down (e.g. -50%) from the baseline captured when the alert was created.
create table if not exists price_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_users(id) on delete cascade,
  token_address text not null,
  symbol text,
  direction text not null,            -- up | down
  pct numeric not null,               -- percent move from baseline (2x => 100)
  label text,                         -- human label, e.g. "2x" or "down 50%"
  baseline_price numeric,             -- token price (USD) when the alert was set
  enabled boolean not null default true,
  repeat boolean not null default false,  -- re-arm after firing (else auto-off)
  last_price numeric,
  triggered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists price_alerts_enabled on price_alerts (enabled);
create index if not exists price_alerts_owner on price_alerts (owner_id);

-- Audit log of every email we attempt to send (for the admin + debugging).
create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_users(id) on delete set null,
  to_email text,
  subject text,
  kind text,                          -- trade | price_alert | test | signal
  status text,                        -- sent | failed
  error text,
  created_at timestamptz not null default now()
);
create index if not exists email_log_time on email_log (created_at desc);

alter table signals add column if not exists last_alert_multiple numeric;


-- Admin-curated smart-money wallets for whale-buy signals.
alter table admin_config add column if not exists whale_wallets text;
create table if not exists whale_alerts (
  signature text primary key,
  wallet text,
  label text,
  token_address text,
  created_at timestamptz not null default now()
);
create index if not exists whale_alerts_time on whale_alerts (created_at desc);


-- Scanner: admin-pinned tokens + hidden trading fee.
alter table admin_config add column if not exists pinned_tokens text;
alter table admin_config add column if not exists fee_enabled boolean not null default false;
alter table admin_config add column if not exists fee_percent numeric not null default 0.5;
alter table admin_config add column if not exists fee_wallet text;

-- "Most searched" tokens counter for the Scanner Searched tab.
create table if not exists token_searches (
  address text primary key,
  symbol text,
  name text,
  hits integer not null default 0,
  last_query text,
  last_at timestamptz not null default now()
);
create index if not exists token_searches_hits on token_searches (hits desc);


-- Custodial in-app wallets. secret_enc is AES-256-GCM encrypted with
-- WALLET_MASTER_KEY; the plaintext key never leaves the server.
create table if not exists user_wallets (
  owner_id uuid primary key references app_users(id) on delete cascade,
  public_key text not null,
  secret_enc text not null,
  created_at timestamptz not null default now()
);

-- Per-user auto-trade preferences.
create table if not exists user_trade_settings (
  owner_id uuid primary key references app_users(id) on delete cascade,
  auto_trade_enabled boolean not null default false,
  max_buy_sol numeric not null default 0.1,
  daily_cap_sol numeric not null default 1,
  min_confidence integer not null default 70,
  updated_at timestamptz not null default now()
);

-- Custodial wallet activity log (deposit/withdraw/buy/sell/fee).
create table if not exists wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_users(id) on delete cascade,
  kind text not null,
  token_address text,
  sol_amount numeric,
  signature text,
  status text not null default 'confirmed',
  note text,
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_owner on wallet_transactions (owner_id, created_at desc);

-- ============================================================================
-- v2 additions: branding, ads, cron heartbeats
-- Safe to run repeatedly on an existing database (idempotent).
-- ============================================================================

-- ── Branding + ads master switch on the singleton admin_config row ──────────
alter table admin_config add column if not exists brand_name text default '';
alter table admin_config add column if not exists logo_url text default '';
alter table admin_config add column if not exists favicon_url text default '';
alter table admin_config add column if not exists logo_height int default 28;
alter table admin_config add column if not exists show_brand_name boolean default true;
alter table admin_config add column if not exists accent_color text default '';
alter table admin_config add column if not exists ads_enabled boolean default false;

-- ── Ad creatives ────────────────────────────────────────────────────────────
create table if not exists site_ads (
  id uuid primary key default gen_random_uuid(),
  slot text not null,
  title text,
  image_url text,
  link_url text,
  html text,
  enabled boolean not null default true,
  weight numeric not null default 1,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists site_ads_slot_enabled on site_ads (slot, enabled);

-- Atomic counter bump so concurrent page views cannot lose impressions.
create or replace function bump_ad_counter(ad_id uuid, counter text)
returns void language plpgsql as $$
begin
  if counter = 'click' then
    update site_ads set clicks = clicks + 1 where id = ad_id;
  else
    update site_ads set impressions = impressions + 1 where id = ad_id;
  end if;
end;
$$;

-- ── Cron heartbeats (powers the admin Automation health panel) ──────────────
create table if not exists cron_runs (
  id bigserial primary key,
  job text not null,
  status text not null,
  duration_ms int,
  error text,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cron_runs_job_time on cron_runs (job, created_at desc);

-- Keep the heartbeat table small: drop rows older than 7 days.
create or replace function prune_cron_runs()
returns void language sql as $$
  delete from cron_runs where created_at < now() - interval '7 days';
$$;

-- ── Telegram buy button routing (v2.1) ──
-- Which destination the "Buy" button in a Telegram signal points at, plus the
-- referral code and a URL template for routes that aren't hardcoded.
alter table admin_config add column if not exists tg_buy_route text default 'jupiter';
alter table admin_config add column if not exists tg_buy_ref text default '';
alter table admin_config add column if not exists tg_buy_template text default '';

-- ─────────────────────────────────────────────────────────────────────────────
-- v2.2 — Email sign-in codes (admin login from any device, no wallet needed)
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per requested login code. The plaintext code is NEVER stored: only a
-- SHA-256 hash, so a database leak cannot be used to sign in.
create table if not exists email_login_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  user_id uuid references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false,
  attempts integer not null default 0,
  requested_ip text,
  created_at timestamptz not null default now()
);

-- Lookup path for verification (newest unused code for an address).
create index if not exists email_login_codes_lookup
  on email_login_codes (lower(email), created_at desc);

-- Sign-in resolves users by email, so make that lookup fast and
-- case-insensitive. Not unique: existing rows may legitimately share/blank it.
create index if not exists app_users_email_lower
  on app_users (lower(email));


-- =====================================================================
-- v2.3  SECURITY HARDENING
-- Safe to re-run: everything below is create/alter "if not exists".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Revocable server-side sessions
--
-- The session cookie used to be a self-contained signed string, which meant a
-- stolen cookie could not be invalidated. Now the cookie holds a random token
-- and only its SHA-256 hash is stored here, so this table is not replayable as
-- a login even if the database leaks.
-- ---------------------------------------------------------------------
create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  revoked_at timestamptz,
  user_agent text,
  ip text
);

-- Every authenticated request looks a session up by hash.
create index if not exists user_sessions_token on user_sessions (token_hash);
create index if not exists user_sessions_user on user_sessions (user_id, revoked);

-- ---------------------------------------------------------------------
-- 2. Shared rate-limit counters
--
-- In-memory counters do not work on serverless: each instance has its own and
-- they vanish on cold start. Attempts are counted here so the limit is real.
-- ---------------------------------------------------------------------
create table if not exists rate_hits (
  id bigserial primary key,
  bucket text not null,
  identifier text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_hits_lookup
  on rate_hits (bucket, identifier, created_at desc);

-- ---------------------------------------------------------------------
-- 3. Withdrawal confirmation codes
--
-- code_hash covers destination + amount + code, so an approval for one transfer
-- cannot be replayed for a different one.
-- ---------------------------------------------------------------------
create table if not exists withdraw_confirmations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_users (id) on delete cascade,
  code_hash text not null,
  to_address text not null,
  amount_sol numeric not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists withdraw_confirmations_lookup
  on withdraw_confirmations (owner_id, code_hash, used);

-- ---------------------------------------------------------------------
-- 4. Per-user withdrawal limits
--
-- Defaults are deliberately restrictive: a user who never opens settings still
-- gets a ceiling on how much can leave in one transfer and per 24 hours.
-- ---------------------------------------------------------------------
alter table user_trade_settings
  add column if not exists max_withdraw_sol numeric not null default 5;
alter table user_trade_settings
  add column if not exists daily_withdraw_cap_sol numeric not null default 10;
alter table user_trade_settings
  add column if not exists withdraw_confirm_required boolean not null default false;
alter table user_trade_settings
  add column if not exists withdraw_allowlist jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------
-- 5. Row Level Security on every table
--
-- HOW THIS WORKS, AND WHY IT MATTERS
-- The anon key is public: it ships to the browser. Until now, RLS was off, so
-- anyone who read the anon key out of the page source could query these tables
-- directly through the Supabase REST endpoint and read wallets, sessions and
-- user records. Enabling RLS with no policies means "deny everything" for the
-- anon and authenticated roles.
--
-- The app is unaffected: every server query uses the SERVICE ROLE key, which
-- bypasses RLS by design. So this closes the public door without adding any
-- policy the application has to satisfy.
--
-- Keep SUPABASE_SERVICE_ROLE_KEY server-side only. Never expose it to the
-- browser or prefix it with NEXT_PUBLIC_.
-- ---------------------------------------------------------------------
-- Enabling RLS one table at a time fails the whole script if a single table is
-- missing (for example an older database created before the ads feature). This
-- loop skips absent tables instead, so it works on any vintage of the schema
-- and stays safe to re-run.
do $$
declare
  t text;
  wanted text[] := array[
    'app_users', 'auth_nonces', 'admin_config', 'site_ads', 'cron_runs',
    'user_wallets', 'wallet_transactions', 'user_trade_settings', 'watchlist',
    'price_alerts', 'signals', 'buy_orders', 'limit_orders', 'tracked_wallets',
    'whale_alerts', 'holder_snapshots', 'safety_cache', 'token_searches',
    'email_log', 'email_login_codes', 'user_sessions', 'rate_hits',
    'withdraw_confirmations'
  ];
begin
  foreach t in array wanted loop
    if exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = t
    ) then
      execute format('alter table public.%I enable row level security', t);
    else
      raise notice 'skipping RLS: table % does not exist yet', t;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Housekeeping
--
-- rate_hits and expired codes/sessions grow forever otherwise. The
-- /api/cron/outcomes job calls this, so no extra scheduler entry is needed.
-- ---------------------------------------------------------------------
-- Uses plpgsql with dynamic SQL rather than `language sql`, because a plain SQL
-- function validates every table reference at creation time and would fail on a
-- database that has not created these tables yet.
create or replace function purge_security_rows()
returns void
language plpgsql
as $$
begin
  if to_regclass('public.rate_hits') is not null then
    delete from rate_hits where created_at < now() - interval '2 days';
  end if;

  if to_regclass('public.user_sessions') is not null then
    delete from user_sessions
      where expires_at < now() - interval '7 days'
         or (revoked and revoked_at < now() - interval '7 days');
  end if;

  if to_regclass('public.withdraw_confirmations') is not null then
    delete from withdraw_confirmations where expires_at < now() - interval '1 day';
  end if;

  if to_regclass('public.email_login_codes') is not null then
    delete from email_login_codes where expires_at < now() - interval '1 day';
  end if;
end $$;
