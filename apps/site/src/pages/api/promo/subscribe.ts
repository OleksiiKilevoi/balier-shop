import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { checkRateLimit } from '@balier/lib/rateLimit';
import { createDb } from '@balier/lib/db';
import { issuePromoCode } from '@balier/lib/db/queries/promo';
import { getPromoSettings } from '@balier/lib/db/queries/settings';
import { sendPromoCodeEmail } from '@balier/lib/notify/email';
import { promoSubscribeSchema } from '@balier/lib/validation/promo';

export const prerender = false;

/**
 * The popup's one call: an e-mail in, a code out — by e-mail, never in the
 * response, because the address *is* the condition of the discount. The
 * response is the same whether the address was new or already had a code
 * (the same code is simply sent again), so the endpoint reveals nothing
 * about who has asked before.
 *
 * Two budgets, and the second is the one that matters: the per-IP one in
 * `src/middleware.ts` stops a sprayer, but rotating IPs would still let
 * someone aim our mail at a stranger's inbox over and over (audit,
 * 2026-09-22). So an address is worth two letters a day, whoever asks, and
 * the answer stays the same `{ ok: true }` when it has had them.
 */
const EMAIL_LIMIT = 2;
const EMAIL_WINDOW_SECONDS = 24 * 60 * 60;
export const POST: APIRoute = async ({ request }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = promoSubscribeSchema.safeParse(payload);
  if (!parsed.success) return json({ error: 'invalid_email' }, 400);

  const db = createDb(env.DATABASE_URL);
  const settings = await getPromoSettings(db);
  if (!settings.enabled) return json({ error: 'promo_disabled' }, 404);

  const address = await checkRateLimit(
    env.RATE_LIMIT,
    `promo-subscribe:${parsed.data.email}`,
    EMAIL_LIMIT,
    EMAIL_WINDOW_SECONDS,
  );
  // Silent by design: the caller learns nothing about whether this address has
  // asked before, and the code it already holds is still valid.
  if (!address.allowed) return json({ ok: true }, 200);

  const promo = await issuePromoCode(db, parsed.data.email, settings.percent);

  try {
    await sendPromoCodeEmail(env.EMAIL, env.ORDER_EMAIL_FROM, {
      to: promo.email,
      code: promo.code,
      percent: promo.percent,
      siteUrl: new URL(request.url).origin,
    });
  } catch (err) {
    console.error('Promo code email failed to send', err);
    return json({ error: 'email_failed' }, 502);
  }

  return json({ ok: true }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
