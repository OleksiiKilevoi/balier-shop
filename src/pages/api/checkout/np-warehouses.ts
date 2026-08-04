import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '~/lib/db';
import { listWarehouses } from '~/lib/db/queries/novaposhta';

export const prerender = false;

const RESULT_LIMIT = 50;

/**
 * The checkout delivery step's warehouse/postomat picker for a chosen
 * settlement — a search-filtered list (`q`), not a full dump. Reads
 * `np_warehouses`, never the live Nova Poshta API.
 */
export const GET: APIRoute = async ({ url }) => {
  const settlementRef = url.searchParams.get('settlementRef');
  const kind = url.searchParams.get('kind');
  const q = url.searchParams.get('q') ?? '';

  if (!settlementRef || (kind !== 'np_warehouse' && kind !== 'np_postomat')) {
    return new Response(JSON.stringify({ error: 'invalid_request' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const db = createDb(env.DATABASE_URL);
  const results = await listWarehouses(db, settlementRef, kind, q, RESULT_LIMIT);

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
