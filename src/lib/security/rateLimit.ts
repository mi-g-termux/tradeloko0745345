// Rate limiting.
//
// WHY DATABASE-BACKED
// -------------------
// The first version of this project limited attempts with module-level counters.
// On serverless that is close to useless: every instance keeps its own counter
// and they reset on cold start, so "5 attempts per 10 minutes" really meant
// "5 per instance, forgotten often". Anything guarding a secret must count in
// shared storage. This module counts hits in Postgres.
//
// The in-memory layer is only a fast path in front of the database (and a
// fallback when Supabase is unconfigured), never the sole limit for a
// security-sensitive action.
import { NextResponse } from "next/server";
import { getServiceClient } from "../supabase";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Extract the caller's IP from proxy headers (Vercel, nginx, Cloudflare). */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    "unknown"
  );
}

interface MemBucket {
  count: number;
  resetAt: number;
}
const mem = new Map<string, MemBucket>();

function memHit(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  const found = mem.get(key);
  if (!found || found.resetAt <= now) {
    mem.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  found.count += 1;
  const remaining = Math.max(0, limit - found.count);
  return {
    allowed: found.count <= limit,
    remaining,
    retryAfterSec: Math.max(1, Math.ceil((found.resetAt - now) / 1000)),
  };
}

// Keep the map from growing without bound on long-lived hosts.
function sweepMem(): void {
  if (mem.size < 5000) return;
  const now = Date.now();
  for (const [k, v] of mem) if (v.resetAt <= now) mem.delete(k);
}

/**
 * Count one hit against `bucket:identifier` and report whether it is allowed.
 *
 * Fails OPEN on database errors: a broken limiter must not take the whole site
 * offline. Sensitive endpoints pair this with their own hard checks (a valid
 * session, a hashed secret), so failing open never means "access granted".
 */
export async function checkRateLimit(opts: {
  bucket: string;
  identifier: string;
  limit: number;
  windowSec: number;
}): Promise<RateLimitResult> {
  const { bucket, limit, windowSec } = opts;
  const identifier = opts.identifier || "unknown";
  const key = bucket + ":" + identifier;

  sweepMem();
  const local = memHit(key, limit, windowSec);
  // Already over the limit on this instance alone: no need to ask the database.
  if (!local.allowed) return local;

  const db = getServiceClient();
  if (!db) return local;

  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  try {
    await db.from("rate_hits").insert({ bucket, identifier });
    const { count, error } = await db
      .from("rate_hits")
      .select("id", { count: "exact", head: true })
      .eq("bucket", bucket)
      .eq("identifier", identifier)
      .gte("created_at", since);
    if (error) return local;
    const used = count ?? 0;
    return {
      allowed: used <= limit,
      remaining: Math.max(0, limit - used),
      retryAfterSec: used > limit ? windowSec : 0,
    };
  } catch {
    return local;
  }
}

/** Standard 429 response with a Retry-After header. */
export function tooManyRequests(
  result: RateLimitResult,
  message = "Too many requests. Slow down and try again shortly.",
): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, result.retryAfterSec)) },
    },
  );
}

/**
 * Guard for public GET endpoints that proxy paid upstream APIs (Helius,
 * Birdeye, Gemini). Returns a 429 response to return early, or null to proceed.
 */
export async function guardPublicRoute(
  req: Request,
  bucket: string,
  limit = 60,
  windowSec = 60,
): Promise<NextResponse | null> {
  const result = await checkRateLimit({
    bucket,
    identifier: clientIp(req),
    limit,
    windowSec,
  });
  if (result.allowed) return null;
  return tooManyRequests(
    result,
    "Rate limit reached for this endpoint. Try again in a moment.",
  );
}
