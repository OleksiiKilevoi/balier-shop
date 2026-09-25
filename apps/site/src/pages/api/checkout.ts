import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb, createTxDb } from '@balier/lib/db';
import { getCodLimitKopiykas, getPaymentTtlMinutes, getPromoSettings } from '@balier/lib/db/queries/settings';
import { createMonobankPayment } from '@balier/lib/monobank';
import { monoPartsFromEnv } from '@balier/lib/monoparts';
import { createEmailNotifier } from '@balier/lib/notify/email';
import { createTelegramNotifier } from '@balier/lib/notify/telegram';
import { createOrder } from '@balier/lib/orders/create';
import { checkoutRequestSchema } from '@balier/lib/validation/checkout';

export const prerender = false;

/**
 * Places an order. Reprices and re-locks the cart against the database
 * inside `createOrder` — the request body's items are intent only, exactly
 * like `/api/cart`, just with no room to clamp: any change refuses the whole
 * order (`cart_changed`) so the customer reviews the real cart before money
 * moves.
 *
 * Rate limited per IP in `src/middleware.ts` (tightest budget of any route —
 * this one calls Monobank and creates a row; it is also the only bot defence
 * the endpoint has).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = checkoutRequestSchema.safeParse(payload);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);
  if (parsed.data.items.length === 0) return json({ error: 'empty_cart' }, 400);

  const db = createDb(env.DATABASE_URL);
  const [codLimitKopiykas, paymentTtlMinutes, promo] = await Promise.all([
    getCodLimitKopiykas(db),
    getPaymentTtlMinutes(db),
    getPromoSettings(db),
  ]);

  const parts = monoPartsFromEnv(env);
  if (parsed.data.paymentMethod === 'parts' && !parts) return json({ error: 'parts_unavailable' }, 400);
  const origin = new URL(request.url).origin;

  const { db: txDb, close } = createTxDb(env.DATABASE_URL);

  try {
    const result = await createOrder(
      txDb,
      {
        customerName: parsed.data.customerName,
        customerPhone: parsed.data.customerPhone,
        customerEmail: parsed.data.customerEmail,
        delivery: parsed.data.delivery,
        paymentMethod: parsed.data.paymentMethod,
        comment: parsed.data.comment,
        items: parsed.data.items,
        promoCode: parsed.data.promoCode,
      },
      {
        payment:
          parsed.data.paymentMethod === 'parts' && parts ? parts : createMonobankPayment(env.MONOBANK_TOKEN),
        notifier: createTelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID),
        email: createEmailNotifier(env.EMAIL, env.ORDER_EMAIL_FROM),
        redirectBaseUrl: origin,
        webhookUrl: new URL(
          parsed.data.paymentMethod === 'parts' ? '/api/webhooks/mono-parts' : '/api/webhooks/monobank',
          origin,
        ).toString(),
        paymentTtlMinutes,
        codLimitKopiykas,
        promoEnabled: promo.enabled,
      },
    );

    if (result.ok) {
      return json({ orderNumber: result.orderNumber, redirectUrl: result.redirectUrl }, 200);
    }

    switch (result.reason) {
      case 'cart_changed':
        return json({ error: 'cart_changed', notices: result.notices }, 409);
      case 'cod_over_limit':
        return json({ error: 'cod_over_limit', codLimitKopiykas }, 400);
      case 'promo_invalid':
      case 'promo_used':
      case 'promo_not_first':
        return json({ error: result.reason }, 400);
      case 'parts_unavailable':
        return json({ error: 'parts_unavailable' }, 400);
      case 'payment_failed':
        return json({ error: 'payment_failed' }, 502);
    }
  } finally {
    locals.cfContext.waitUntil(close());
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
