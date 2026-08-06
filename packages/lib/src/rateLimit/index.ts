export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window resets — only meaningful when `!allowed`. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter in KV: `${key}:${windowStart}` holds a count, TTL'd to
 * outlive its own window so a slow reader never resurrects an expired one.
 *
 * Not atomic — KV has no increment primitive, so two requests racing the same
 * window can both read the same count and both be admitted a step past the
 * limit. Fine for abuse deterrence (bursts still get capped one window later);
 * not fine for anything that has to bill on the count.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const result = await peekRateLimit(kv, key, limit, windowSeconds);
  if (result.allowed) await recordRateLimitHit(kv, key, windowSeconds);

  return result;
}

/**
 * The same check without spending anything — "would this be allowed?".
 *
 * Split out for the admin login form, where the two halves belong to different
 * moments: a *wrong* password should cost budget, a correct one should not.
 * Counting every POST means an operator who signs in from three devices after
 * two typos has spent five of their own attempts on nothing, and the limiter
 * ends up locking out the one person it exists to protect. Pair with
 * `recordRateLimitHit` on the failure path only.
 */
export async function peekRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;

  const current = Number((await kv.get(`${key}:${windowStart}`)) ?? '0');

  return {
    allowed: current < limit,
    retryAfterSeconds: windowStart + windowSeconds - nowSeconds,
  };
}

/** Spend one unit of `key`'s budget for the current window. */
export async function recordRateLimitHit(
  kv: KVNamespace,
  key: string,
  windowSeconds: number,
): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const kvKey = `${key}:${windowStart}`;

  const current = Number((await kv.get(kvKey)) ?? '0');
  await kv.put(kvKey, String(current + 1), { expirationTtl: windowSeconds * 2 });
}
