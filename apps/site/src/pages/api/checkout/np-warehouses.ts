import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '@balier/lib/db';
import { jsonWithEdgeCache, normalizeCacheParam } from '~/lib/edgeCache';
import { listWarehouses } from '@balier/lib/db/queries/novaposhta';

export const prerender = false;

const RESULT_LIMIT = 50;

/** Same reasoning as the settlement route — see its comment. */
const EDGE_TTL_SECONDS = 3600;
const BROWSER_TTL_SECONDS = 60;

/**
 * The checkout delivery step's warehouse/postomat picker for a chosen
 * settlement — a search-filtered list (`q`), not a full dump. Reads
 * `np_warehouses`, never the live Nova Poshta API.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  // Capped like `q`: both end up in a cache key, and an uncapped one is an
  // unbounded number of distinct entries.
  const settlementRef = normalizeCacheParam(url.searchParams.get('settlementRef'));
  const kind = url.searchParams.get('kind');
  const query = normalizeCacheParam(url.searchParams.get('q'));

  if (!settlementRef || (kind !== 'np_warehouse' && kind !== 'np_postomat')) {
    return new Response(JSON.stringify({ error: 'invalid_request' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return jsonWithEdgeCache(
    {
      // `settlementRef` is an opaque NP GUID and already canonical; only the
      // free-text part needed normalising.
      key:
        `${url.origin}/api/checkout/np-warehouses` +
        `?settlementRef=${encodeURIComponent(settlementRef)}` +
        `&kind=${kind}&q=${encodeURIComponent(query)}`,
      ttlSeconds: EDGE_TTL_SECONDS,
      browserTtlSeconds: BROWSER_TTL_SECONDS,
      waitUntil: (promise) => locals.cfContext.waitUntil(promise),
    },
    () => listWarehouses(createDb(env.DATABASE_URL), settlementRef, kind, query, RESULT_LIMIT),
  );
};
