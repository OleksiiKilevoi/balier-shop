import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createTxDb } from '~/lib/db';
import { createMonobankPayment } from '~/lib/monobank';
import { createEmailNotifier } from '~/lib/notify/email';
import { createTelegramNotifier } from '~/lib/notify/telegram';
import { confirmPayment } from '~/lib/orders/confirmPayment';

export const prerender = false;

/**
 * The only place an order becomes `paid` (`docs/CONVENTIONS.md`). Order from
 * `docs/OVERVIEW.md`, followed exactly:
 *  1. read the raw body as text — the signature is computed over the bytes,
 *     not over whatever `.json()` would re-serialize;
 *  2. verify `X-Sign`, otherwise 403;
 *  3. re-check status via `GET invoice/status` — the webhook body itself is
 *     never trusted for anything but which `invoiceId` to look up;
 *  4. transition the order inside a transaction (`confirmPayment`), if valid;
 *  5. respond quickly.
 *
 * The manager's «Оплачено» Telegram message and the customer's order-
 * confirmation email are both sent from here, on the `paid` transition only —
 * `confirmPayment`'s idempotency means a redelivered webhook reports
 * `unchanged` and so can't produce a second message. Both go through
 * `waitUntil` rather than being awaited: Monobank wants a fast 200, and both
 * notifiers are best-effort by contract anyway.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const rawBody = await request.text();
  const signature = request.headers.get('x-sign');

  const payment = createMonobankPayment(env.MONOBANK_TOKEN);
  const verified = await payment.verifyWebhook(rawBody, signature);
  if (!verified) return new Response(null, { status: 403 });

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }

  const invoiceId =
    typeof parsedBody === 'object' && parsedBody !== null && 'invoiceId' in parsedBody
      ? (parsedBody as { invoiceId: unknown }).invoiceId
      : undefined;

  if (typeof invoiceId !== 'string') return new Response(null, { status: 400 });

  const statusResult = await payment.getInvoiceStatus(invoiceId);

  const { db: txDb, close } = createTxDb(env.DATABASE_URL);
  try {
    const result = await confirmPayment(txDb, invoiceId, statusResult, parsedBody);
    if (!result.ok) {
      console.warn(`Monobank webhook: no payment found for invoice ${invoiceId}`);
    } else if (result.transitioned === 'paid') {
      const notifier = createTelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
      const email = createEmailNotifier(env.EMAIL, env.ORDER_EMAIL_FROM);
      locals.cfContext.waitUntil(notifier.orderPaid({ order: result.order, items: result.items }));
      locals.cfContext.waitUntil(email.orderPaid({ order: result.order, items: result.items }));
    }
  } finally {
    locals.cfContext.waitUntil(close());
  }

  return new Response(null, { status: 200 });
};
