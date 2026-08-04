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
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const retryAfterSeconds = windowStart + windowSeconds - nowSeconds;
  const kvKey = `${key}:${windowStart}`;

  const current = Number((await kv.get(kvKey)) ?? '0');
  if (current >= limit) {
    return { allowed: false, retryAfterSeconds };
  }

  await kv.put(kvKey, String(current + 1), { expirationTtl: windowSeconds * 2 });
  return { allowed: true, retryAfterSeconds };
}
