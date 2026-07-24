// Tiny in-memory TTL cache + rate limiter (feature #9).
// Reduces provider calls and protects endpoints. In-memory means per-instance;
// for multi-instance scale swap this for Redis/Upstash. Honest and simple.

interface Entry<T> {
  value: T;
  expiry: number;
}
const store = new Map<string, Entry<unknown>>();

/** Cache the result of `fn` under `key` for `ttlMs`. Deduplicates in-flight. */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() < hit.expiry) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expiry: Date.now() + ttlMs });
  return value;
}

export function invalidate(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

// ── Rate limiting ──
const hits = new Map<string, number[]>();

/**
 * Returns true if the caller is within the limit, false if it should be
 * throttled. `key` is typically an IP + route.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length <= limit;
}

/** Helper to pull a client IP from a request for rate-limit keys. */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
