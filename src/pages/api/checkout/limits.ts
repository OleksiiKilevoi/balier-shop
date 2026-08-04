import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '~/lib/db';
import { getCodLimitKopiykas } from '~/lib/db/queries/settings';

export const prerender = false;

/**
 * Primes `/checkout`'s payment-method step: the cash-on-delivery limit is an
 * admin-editable setting (`settings.cod_limit`, no admin UI to write it yet —
 * Phase 4), not a build-time constant, so the page has to ask for it.
 */
export const GET: APIRoute = async () => {
  const db = createDb(env.DATABASE_URL);
  const codLimitKopiykas = await getCodLimitKopiykas(db);

  return new Response(JSON.stringify({ codLimitKopiykas }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
