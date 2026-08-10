import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb, createTxDb } from '@balier/lib/db';
import { getCodLimitKopiykas, getPaymentTtlMinutes } from '@balier/lib/db/queries/settings';
import { createMonobankPayment } from '@balier/lib/monobank';
import { createEmailNotifier } from '@balier/lib/notify/email';
import { createTelegramNotifier } from '@balier/lib/notify/telegram';
import { createOrder } from '@balier/lib/orders/create';
// Turnstile: import { createTurnstileCaptcha } from '@balier/lib/turnstile';
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
 * left while Turnstile is commented out below).
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

  // Turnstile: disabled 2026-08-05 on request — commented out, not deleted.
  // `src/lib/turnstile/` and its tests are untouched; restoring means
  // uncommenting this, the `turnstileToken` field in
  // `src/lib/validation/checkout.ts`, and the blocks marked `Turnstile:` in
  // `src/pages/checkout.astro`.
  //
  // const captcha = createTurnstileCaptcha(env.TURNSTILE_SECRET_KEY);
  // const captchaOk = await captcha.verify(
  //   parsed.data.turnstileToken,
  //   request.headers.get('cf-connecting-ip') ?? undefined,
  // );
  // if (!captchaOk) return json({ error: 'captcha_failed' }, 400);

  const db = createDb(env.DATABASE_URL);
  const [codLimitKopiykas, paymentTtlMinutes] = await Promise.all([
    getCodLimitKopiykas(db),
    getPaymentTtlMinutes(db),
  ]);

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
      },
      {
        payment: createMonobankPayment(env.MONOBANK_TOKEN),
        notifier: createTelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID),
        email: createEmailNotifier(env.EMAIL, env.ORDER_EMAIL_FROM),
        redirectBaseUrl: new URL(request.url).origin,
        webhookUrl: new URL('/api/webhooks/monobank', new URL(request.url).origin).toString(),
        paymentTtlMinutes,
        codLimitKopiykas,
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
