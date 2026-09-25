import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '@balier/lib/db';
import { jsonWithEdgeCache, normalizeCacheParam } from '~/lib/edgeCache';
import { listAllWarehouses } from '@balier/lib/db/queries/novaposhta';

export const prerender = false;

/**
 * A day at the edge: `np_warehouses` changes once a night (the cron's 04:00
 * sync), so a settlement costs the database one query per edge location per
 * day. An hour in the browser, so a returning customer loads nothing.
 */
const EDGE_TTL_SECONDS = 24 * 60 * 60;
const BROWSER_TTL_SECONDS = 60 * 60;

/**
 * The checkout's warehouse/postomat picker: the whole list for one settlement
 * and kind, compact (`WarehouseRow[]`), downloaded once when the field is
 * focused — the typing is searched in the browser, with no request per key.
 * Kyiv's lockers, the largest list, are ~7 400 rows. Reads `np_warehouses`,
 * never the live Nova Poshta API.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  // Capped: it ends up in a cache key, and an uncapped one is an unbounded
  // number of distinct entries.
  const settlementRef = normalizeCacheParam(url.searchParams.get('settlementRef'));
  const kind = url.searchParams.get('kind');

  if (!settlementRef || (kind !== 'np_warehouse' && kind !== 'np_postomat')) {
    return new Response(JSON.stringify({ error: 'invalid_request' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return jsonWithEdgeCache(
    {
      // `settlementRef` is an opaque NP GUID and already canonical. `v=all`
      // keeps these apart from the per-query entries the old picker cached.
      key:
        `${url.origin}/api/checkout/np-warehouses` +
        `?settlementRef=${encodeURIComponent(settlementRef)}&kind=${kind}&v=all`,
      ttlSeconds: EDGE_TTL_SECONDS,
      browserTtlSeconds: BROWSER_TTL_SECONDS,
      waitUntil: (promise) => locals.cfContext.waitUntil(promise),
    },
    () => listAllWarehouses(createDb(env.DATABASE_URL), settlementRef, kind),
  );
};
