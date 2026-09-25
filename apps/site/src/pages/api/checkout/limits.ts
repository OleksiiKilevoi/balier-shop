import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '@balier/lib/db';
import { getCodLimitKopiykas, getPromoSettings } from '@balier/lib/db/queries/settings';
import { PARTS_COUNTS, PARTS_MIN_TOTAL, monoPartsFromEnv } from '@balier/lib/monoparts';

export const prerender = false;

/**
 * Primes `/checkout`'s payment-method step: the cash-on-delivery limit is an
 * admin-editable setting (`settings.cod_limit`, written by `/admin/settings`),
 * not a build-time constant, so the page has to ask for it. `cache-control:
 * no-store` below is what makes an edit in the panel take effect on the next
 * checkout rather than on the next deploy.
 */
export const GET: APIRoute = async () => {
  const db = createDb(env.DATABASE_URL);
  const [codLimitKopiykas, promoSettings] = await Promise.all([
    getCodLimitKopiykas(db),
    getPromoSettings(db),
  ]);
  // `promo` doubles as the popup's switch (`PromoPopup.astro`) and the
  // checkout summary's preview percentage; the server still decides at submit.
  const promo = promoSettings.enabled ? { percent: promoSettings.percent } : null;

  // «Частинами» is offered only when its keys are set; the minimum and the
  // largest count drive the «від N ₴» hint.
  const parts = monoPartsFromEnv(env)
    ? { minTotalKopiykas: PARTS_MIN_TOTAL, maxCount: Math.max(...PARTS_COUNTS) }
    : null;

  return new Response(JSON.stringify({ codLimitKopiykas, promo, parts }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
