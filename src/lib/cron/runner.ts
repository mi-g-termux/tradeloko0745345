// Shared cron plumbing for every /api/cron/* route.
//
// ── Why this exists ─────────────────────────────────────────────────────
// "Signals don't arrive at regular intervals" was not only a scoring problem:
// there was NO way to see whether the scheduled jobs were actually running.
// Each route re-implemented its own auth (inconsistently — one of them let
// unauthenticated callers through when CRON_SECRET was unset), and nothing was
// recorded, so a silently failing cron-job.org entry looked identical to a
// working one.
//
// Every cron route now runs through `runCronJob`, which:
//   1. authenticates uniformly (Bearer header OR ?key=, never open),
//   2. records a heartbeat row (start, duration, status, error, result),
//   3. returns a consistent JSON envelope,
//   4. powers the "Automation health" panel in the admin UI.
import { NextResponse } from "next/server";
import { SERVER_ENV, rememberBaseUrl } from "../config";
import { getServiceClient } from "../supabase";
import type { CronRunInfo } from "../types";

export type CronJobName =
  | "scan"
  | "keeper"
  | "copytrade"
  | "outcomes"
  | "holders"
  | "signal-updates"
  | "price-alerts"
  | "whale-signals"
  | "user-autotrade"
  | "wallet-sync"
  | "boost-expire";

/**
 * The cadence each job is DESIGNED for. Used to build the copy-paste
 * cron-job.org schedule list and to flag overdue jobs in the admin panel.
 */
export const CRON_JOBS: Array<{
  job: CronJobName;
  path: string;
  everyMinutes: number;
  label: string;
  description: string;
}> = [
  {
    job: "scan",
    path: "/api/cron/scan",
    everyMinutes: 15,
    label: "Signal scanner",
    description:
      "Scans trending tokens, builds full signals and alerts the qualifying ones. This is the job that makes signals arrive on a regular schedule.",
  },
  {
    job: "signal-updates",
    path: "/api/cron/signal-updates",
    everyMinutes: 15,
    label: "Signal follow-ups",
    description: "Sends 2x/3x/5x follow-up alerts on already-alerted signals.",
  },
  {
    job: "price-alerts",
    path: "/api/cron/price-alerts",
    everyMinutes: 5,
    label: "Price alerts",
    description: "Checks user-defined price conditions and emails/DMs on hits.",
  },
  {
    job: "keeper",
    path: "/api/cron/keeper",
    everyMinutes: 5,
    label: "Order keeper",
    description: "Executes limit / take-profit / stop-loss orders.",
  },
  {
    job: "whale-signals",
    path: "/api/cron/whale-signals",
    everyMinutes: 10,
    label: "Whale signals",
    description: "Turns smart-money buys into analysed signals.",
  },
  {
    job: "copytrade",
    path: "/api/cron/copytrade",
    everyMinutes: 10,
    label: "Copy-trade",
    description: "Mirrors buys from copy-enabled tracked wallets.",
  },
  {
    job: "user-autotrade",
    path: "/api/cron/user-autotrade",
    everyMinutes: 15,
    label: "User auto-trade",
    description: "Runs per-user auto-trade rules against fresh signals.",
  },
  {
    job: "outcomes",
    path: "/api/cron/outcomes",
    everyMinutes: 30,
    label: "Outcome tracking",
    description: "Measures 1h/24h returns so the hit-rate stays honest.",
  },
  {
    job: "holders",
    path: "/api/cron/holders",
    everyMinutes: 60,
    label: "Holder snapshots",
    description: "Records holder-concentration trend for safety analysis.",
  },
  {
    job: "wallet-sync",
    path: "/api/cron/wallet-sync",
    everyMinutes: 5,
    label: "Wallet history sync",
    description:
      "Reads each custodial wallet's real signature list from Solana and records anything missing. This is what makes incoming deposits appear in history automatically, and it back-fills withdrawals whose confirmation wait timed out.",
  },
  {
    job: "boost-expire",
    path: "/api/cron/boost-expire",
    everyMinutes: 60,
    label: "Boost expiry",
    description:
      "Retires paid token boosts once their paid-for time is up. Ranking already ignores expired boosts, so this only keeps the order list tidy.",
  },
];

export function cronJobMeta(job: CronJobName) {
  return CRON_JOBS.find((j) => j.job === job);
}

/**
 * Uniform cron authentication.
 *
 * Accepts `Authorization: Bearer <CRON_SECRET>` (what cron-job.org and Vercel
 * Cron send) or `?key=<CRON_SECRET>` for manual curl testing.
 *
 * SECURITY: when CRON_SECRET is unset we DENY. Previously one route returned
 * `true` in that case, which left a publicly callable job-trigger endpoint.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = SERVER_ENV.cronSecret;
  if (!secret) return false;

  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  // Some schedulers only support a custom header.
  if (req.headers.get("x-cron-secret") === secret) return true;
  try {
    return new URL(req.url).searchParams.get("key") === secret;
  } catch {
    return false;
  }
}

/** Persist a heartbeat. Best-effort: a logging failure never fails the job. */
async function recordRun(entry: {
  job: CronJobName;
  status: "ok" | "skipped" | "error";
  durationMs: number;
  error?: string | null;
  result?: unknown;
}): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  try {
    await db.from("cron_runs").insert({
      job: entry.job,
      status: entry.status,
      duration_ms: Math.round(entry.durationMs),
      error: entry.error ?? null,
      // Keep the payload small — these rows are written every few minutes.
      result: entry.result ? JSON.parse(JSON.stringify(entry.result)) : null,
    });
  } catch {
    /* telemetry only */
  }
}

export interface CronOutcome {
  /** "skipped" means the feature is toggled off — not an error. */
  status: "ok" | "skipped";
  reason?: string;
  result?: unknown;
}

/**
 * Wrap a cron handler with auth, timing, heartbeat logging and a consistent
 * response envelope.
 */
export async function runCronJob(
  job: CronJobName,
  req: Request,
  handler: () => Promise<CronOutcome>,
): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    // Do not log unauthenticated probes — that would let anyone flood the table.
    return NextResponse.json(
      {
        error: "Unauthorized",
        hint: "Send Authorization: Bearer <CRON_SECRET>. If CRON_SECRET is unset, set it first — cron endpoints stay closed until then.",
      },
      { status: 401 },
    );
  }

  // Cron jobs are where Telegram/email links get built, but background work has
  // no request of its own. The cron-job.org call itself carries the real host,
  // so record it here and every outbound link becomes correct automatically --
  // on Vercel, cPanel, Render or a custom domain, with no env var set.
  rememberBaseUrl(req);

  const started = Date.now();
  try {
    const outcome = await handler();
    const durationMs = Date.now() - started;
    await recordRun({
      job,
      status: outcome.status,
      durationMs,
      result: outcome.result ?? (outcome.reason ? { reason: outcome.reason } : null),
    });
    return NextResponse.json(
      {
        ok: true,
        job,
        status: outcome.status,
        skipped: outcome.status === "skipped",
        reason: outcome.reason,
        durationMs,
        result: outcome.result ?? null,
        ranAt: new Date(started).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = (err as Error)?.message ?? "Unknown error";
    await recordRun({ job, status: "error", durationMs, error: message });
    // 500 so cron-job.org marks the execution as FAILED and its own history /
    // failure notifications surface the problem instead of hiding it.
    return NextResponse.json(
      { ok: false, job, status: "error", error: message, durationMs },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

interface CronRunRow {
  job: string;
  status: string;
  duration_ms: number | null;
  error: string | null;
  result: unknown;
  created_at: string;
}

/** Health summary for the admin "Automation" panel. */
export async function getCronStatus(): Promise<CronRunInfo[]> {
  const db = getServiceClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  let rows: CronRunRow[] = [];
  if (db) {
    const { data } = await db
      .from("cron_runs")
      .select("job, status, duration_ms, error, result, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    rows = (data as CronRunRow[] | null) ?? [];
  }

  return CRON_JOBS.map((meta) => {
    const mine = rows.filter((r) => r.job === meta.job);
    const latest = mine[0] ?? null;
    const lastRunAt = latest?.created_at ?? null;
    const overdue = lastRunAt
      ? Date.now() - new Date(lastRunAt).getTime() >
        meta.everyMinutes * 60_000 * 2.5
      : true;

    return {
      job: meta.job,
      lastRunAt,
      lastStatus: (latest?.status as CronRunInfo["lastStatus"]) ?? null,
      lastDurationMs: latest?.duration_ms ?? null,
      lastError: latest?.error ?? null,
      lastResult: latest?.result ?? null,
      runs24h: mine.length,
      errors24h: mine.filter((r) => r.status === "error").length,
      expectedEveryMinutes: meta.everyMinutes,
      overdue,
    };
  });
}
