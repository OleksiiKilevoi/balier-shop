import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import * as Sentry from '@sentry/cloudflare';
import { createTxDb } from '@balier/lib/db';
import { monoPartsFromEnv } from '@balier/lib/monoparts';
import { createEmailNotifier } from '@balier/lib/notify/email';
import { createTelegramNotifier } from '@balier/lib/notify/telegram';
import { confirmPayment } from '@balier/lib/orders/confirmPayment';

export const prerender = false;

/**
 * monobank «Покупка частинами» callback — the same contract as
 * `./monobank.ts`, and like it the only place a «частинами» order becomes
 * `paid` (`docs/CONVENTIONS.md`): verify the `signature` header over the raw
 * body, take only `order_id` from it, re-read the state from monobank, and let
 * `confirmPayment` transition inside a transaction. monobank calls this when
 * the client approves (`WAITING_FOR_STORE_CONFIRM` → `paid`) and on any
 * `FAIL/*` (→ `cancelled`); the cron sweep covers a lost callback.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const parts = monoPartsFromEnv(env);
  if (!parts) return new Response(null, { status: 404 });

  const rawBody = await request.text();
  const verified = await parts.verifyWebhook(rawBody, request.headers.get('signature'));
  if (!verified) return new Response(null, { status: 403 });

  let orderId: unknown;
  try {
    orderId = (JSON.parse(rawBody) as { order_id?: unknown }).order_id;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof orderId !== 'string') return new Response(null, { status: 400 });

  const statusResult = await parts.getInvoiceStatus(orderId);

  const { db: txDb, close } = createTxDb(env.DATABASE_URL);
  try {
    const result = await confirmPayment(txDb, orderId, statusResult, JSON.parse(rawBody));
    if (!result.ok) {
      console.warn(`monobank parts callback: no payment found for order ${orderId}`);
    } else if (result.transitioned === 'paid') {
      const notifier = createTelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
      const email = createEmailNotifier(env.EMAIL, env.ORDER_EMAIL_FROM);
      locals.cfContext.waitUntil(notifier.orderPaid({ order: result.order, items: result.items }));
      locals.cfContext.waitUntil(email.orderPaid({ order: result.order, items: result.items }));
    } else if (result.transitioned === 'paid_after_cancellation') {
      // Approved after we cancelled: nothing has been debited yet (that waits
      // for the hand-over), so withdrawing the application is the whole fix.
      locals.cfContext.waitUntil(
        parts.removeInvoice(orderId).catch((err) => {
          console.error(`monobank parts: reject failed for ${orderId}`, err);
          Sentry.captureException(err);
        }),
      );
    }
  } finally {
    locals.cfContext.waitUntil(close());
  }

  return new Response(null, { status: 200 });
};
