import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '@balier/lib/db';
import { searchSettlements } from '@balier/lib/db/queries/novaposhta';

export const prerender = false;

const RESULT_LIMIT = 10;

/**
 * The checkout delivery step's debounced settlement search — reads
 * `np_settlements`, never the live Nova Poshta API (see
 * `src/lib/novaposhta/sync.ts` for what keeps it fresh).
 */
export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get('q') ?? '';
  const db = createDb(env.DATABASE_URL);
  const results = await searchSettlements(db, query, RESULT_LIMIT);

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
