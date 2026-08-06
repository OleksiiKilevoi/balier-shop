import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '@balier/lib/db';
import { jsonWithEdgeCache, normalizeCacheParam } from '~/lib/edgeCache';
import { SETTLEMENT_MIN_QUERY_LENGTH, searchSettlements } from '@balier/lib/db/queries/novaposhta';

export const prerender = false;

const RESULT_LIMIT = 10;

/**
 * How long a settlement lookup may be served from the edge. The underlying
 * table is rewritten once a day by the cron sync, so an hour is far inside the
 * window in which the answer cannot have changed — and it takes the ~45 ms
 * Worker-to-Neon round trip off the common keystroke entirely.
 */
const EDGE_TTL_SECONDS = 3600;
const BROWSER_TTL_SECONDS = 60;

/**
 * The checkout delivery step's debounced settlement search — reads
 * `np_settlements`, never the live Nova Poshta API (see
 * `packages/lib/src/novaposhta/sync.ts` for what keeps it fresh).
 *
 * The query is matched against the folded `search_text`, so Ukrainian, Russian
 * and Latin spellings all land on the same row; `db/queries/novaposhta.ts`
 * carries the detail.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const query = normalizeCacheParam(url.searchParams.get('q'));

  // Too short to search, and cheap enough that caching it would only add a
  // lookup — `searchSettlements` answers this without touching the database.
  if (query.length < SETTLEMENT_MIN_QUERY_LENGTH) {
    return new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return jsonWithEdgeCache(
    {
      key: `${url.origin}/api/checkout/np-settlements?q=${encodeURIComponent(query)}`,
      ttlSeconds: EDGE_TTL_SECONDS,
      browserTtlSeconds: BROWSER_TTL_SECONDS,
      waitUntil: (promise) => locals.cfContext.waitUntil(promise),
    },
    () => searchSettlements(createDb(env.DATABASE_URL), query, RESULT_LIMIT),
  );
};
