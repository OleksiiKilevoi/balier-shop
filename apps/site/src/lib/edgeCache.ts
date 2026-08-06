/**
 * Cloudflare edge caching for this Worker's read-only JSON endpoints.
 *
 * Built for the `/checkout` delivery pickers, where the numbers made the case:
 * the settlement query itself runs in 0.14 ms, but the round trip from the
 * Worker to Neon is ~45 ms, and every keystroke from every customer was paying
 * it. The lookups are public, identical for everyone, and refreshed once a day
 * by cron — so the answers to «ки», «киї», «київ» can simply be kept at the
 * edge, and the common case stops touching Postgres at all.
 *
 * It lives in the app rather than in `@balier/lib` on purpose: `caches.default`
 * is a Workers global, and the lib package deliberately avoids the ambient
 * workers-types (they collide with the DOM lib its client-side modules need —
 * see `packages/lib/src/env.d.ts`). Here the app's generated
 * `worker-configuration.d.ts` supplies it.
 *
 * Two rules make it safe to use:
 *
 *  - **Never for anything personal.** The cache is shared by every visitor on
 *    that colo. Cart contents, orders and admin data must not come near it.
 *  - **The key must be normalised by the caller.** «Київ», «київ» and «київ  »
 *    are the same lookup; if they mint three cache entries the hit rate dies.
 */

/**
 * `caches.default` is a Workers extension, and `worker-configuration.d.ts`
 * does declare it — but Astro's strict tsconfig also pulls in the DOM lib for
 * client-side scripts, whose own `CacheStorage` wins the collision and has no
 * `default`. This is the same clash `packages/lib/src/env.d.ts` documents for
 * the lib package.
 *
 * Narrowed here, at the single point of use, rather than by redeclaring a
 * global: the surface actually used is two methods wide.
 */
interface WorkersCacheStorage {
  readonly default: {
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
  };
}

const edgeCache = () => (caches as unknown as WorkersCacheStorage).default;

export interface EdgeCacheOptions {
  /** Absolute URL used as the cache key. Must already be normalised. */
  key: string;
  /** How long the edge may serve this without asking us again. */
  ttlSeconds: number;
  /** How long the customer's own browser may reuse it. Short by design. */
  browserTtlSeconds: number;
  /** `locals.cfContext.waitUntil` — the write must not delay the response. */
  waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * Returns the cached response if there is one, otherwise builds the body,
 * caches it, and returns it.
 */
export async function jsonWithEdgeCache(
  options: EdgeCacheOptions,
  produce: () => Promise<unknown>,
): Promise<Response> {
  const cache = edgeCache();
  const cacheKey = new Request(options.key, { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const response = new Response(JSON.stringify(await produce()), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // `s-maxage` is the edge's copy, `max-age` the browser's. The browser one
      // is deliberately short: it makes backspacing through a query instant
      // without pinning a stale list in someone's tab for an hour.
      'cache-control': `public, max-age=${options.browserTtlSeconds}, s-maxage=${options.ttlSeconds}`,
    },
  });

  // `put` consumes the body, so the cache gets the clone and the caller the
  // original.
  options.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}

/**
 * Collapses the spelling variants of a free-text query parameter that would
 * otherwise each mint their own cache entry, and caps its length so a hostile
 * client cannot flood the cache with unbounded distinct keys.
 */
export function normalizeCacheParam(value: string | null, maxLength = 64): string {
  return (value ?? '').trim().toLowerCase().slice(0, maxLength);
}
