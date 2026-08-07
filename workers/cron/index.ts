import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { createDb, createTxDb } from '@balier/lib/db';
import { listWaybillOrdersToTrack } from '@balier/lib/db/queries/orders';
import { orders, payments, stockReservations } from '@balier/lib/db/schema';
import { createMonobankPayment } from '@balier/lib/monobank';
import { createEmailNotifier } from '@balier/lib/notify/email';
import { createTelegramNotifier } from '@balier/lib/notify/telegram';
import { createNovaPoshtaClient } from '@balier/lib/novaposhta/client';
import { createNovaPoshtaShipping } from '@balier/lib/novaposhta/shipping';
import { syncNovaPoshtaReferenceData } from '@balier/lib/novaposhta/sync';
import { applyCarrierStatus } from '@balier/lib/orders/applyCarrierStatus';
import { confirmPayment } from '@balier/lib/orders/confirmPayment';

/**
 * Scheduled jobs run in their own Worker rather than in the Astro Worker.
 *
 * The Astro adapter owns the app Worker's entrypoint and exports only `fetch`,
 * so there is nowhere to hang a `scheduled` handler. Keeping crons separate also
 * means a slow reference-data sync can never eat into request-path CPU budget,
 * and the two deploy and roll back independently. Shared domain code is imported
 * from the `@balier/lib` workspace package.
 *
 * Deploy: pnpm cron:deploy
 * Dev:    pnpm cron:dev, then hit the printed `__scheduled` URL with a cron= param.
 */
export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    switch (event.cron) {
      // Every 15 minutes — release reservations for orders that were never
      // paid, and follow every live waybill's carrier status (NP-4).
      case '*/15 * * * *':
        ctx.waitUntil(releaseExpiredReservations(env));
        ctx.waitUntil(trackWaybillStatuses(env));
        break;

      // 04:00 UTC daily — refresh the Nova Poshta settlement/warehouse cache.
      case '0 4 * * *':
        ctx.waitUntil(syncNovaPoshta(env));
        break;

      default:
        console.warn(`Unhandled cron trigger: ${event.cron}`);
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * A 30-minute reservation TTL is meaningless without this: a card checkout
 * that never reaches payment would otherwise hold its stock forever. Cash on
 * delivery never leaves a reservation lying around — `createOrder` resolves
 * it immediately — so this only ever finds card orders that stalled at
 * `pending`/`awaiting_payment`.
 *
 * Two steps, deliberately unequal in caution:
 *
 * 1. **Expired reservations are deleted and `pending` orders cancelled
 *    outright.** `pending` means the invoice was never recorded (`createOrder`
 *    moves to `awaiting_payment` in the same transaction that records it), so
 *    there is nothing to ask Monobank about.
 * 2. **`awaiting_payment` orders are never cancelled on our clock alone.**
 *    The customer may have paid in the invoice's final minute with the
 *    webhook still in flight — or the webhook may simply have been lost. So
 *    every `awaiting_payment` order whose reservation is gone is *reconciled*:
 *    ask Monobank for the invoice's live status and let `confirmPayment`
 *    apply it — `paid` (with the notifications the webhook would have sent),
 *    cancelled on a definitive failure, or left alone until the invoice
 *    itself expires. This doubles as the recovery path for lost webhooks.
 *
 * The freed stock can be resold before a late payment lands; `confirmPayment`
 * accepts that (money beats inventory) and the oversell is handled by hand.
 */
async function releaseExpiredReservations(env: Env): Promise<void> {
  const { db, close } = createTxDb(env.DATABASE_URL);

  try {
    await db.transaction(async (tx) => {
      const expired = await tx
        .delete(stockReservations)
        .where(lt(stockReservations.expiresAt, sql`now()`))
        .returning({ orderId: stockReservations.orderId });

      const orderIds = [...new Set(expired.map((row) => row.orderId))];
      if (orderIds.length === 0) return;

      await tx
        .update(orders)
        .set({ status: 'cancelled', cancelledAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(inArray(orders.id, orderIds), eq(orders.status, 'pending')));
    });

    await reconcileAwaitingPayment(env, db);
  } finally {
    await close();
  }
}

/**
 * Step 2 above. Picks up every `awaiting_payment` order with no live
 * reservation — this sweep's expiries and any stragglers a previous sweep left
 * `unchanged` (invoice still `processing`, or Monobank unreachable) — so an
 * order can never get stuck between sweeps. Network calls happen between
 * transactions, never inside one; `confirmPayment` is idempotent, so a webhook
 * racing this loop is harmless whichever lands first.
 */
async function reconcileAwaitingPayment(
  env: Env,
  db: ReturnType<typeof createTxDb>['db'],
): Promise<void> {
  const stale = await db
    .select({ orderNumber: orders.orderNumber, invoiceId: payments.invoiceId })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(
      and(
        eq(orders.status, 'awaiting_payment'),
        sql`not exists (
          select 1 from ${stockReservations}
          where ${stockReservations.orderId} = ${orders.id}
            and ${stockReservations.expiresAt} > now()
        )`,
      ),
    );

  if (stale.length === 0) return;

  const payment = createMonobankPayment(env.MONOBANK_TOKEN);
  const notifier = createTelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
  const email = createEmailNotifier(env.EMAIL, env.ORDER_EMAIL_FROM);

  for (const row of stale) {
    try {
      const status = await payment.getInvoiceStatus(row.invoiceId);
      const result = await confirmPayment(db, row.invoiceId, status, {
        reconciledBy: 'cron',
        status: status.status,
      });
      if (!result.ok) continue;

      if (result.transitioned === 'paid') {
        // The webhook never landed — this sweep is standing in for it, so it
        // also owes the notifications the webhook would have sent.
        console.warn(`Reconciliation: order ${row.orderNumber} paid, webhook never arrived`);
        await notifier.orderPaid({ order: result.order, items: result.items });
        await email.orderPaid({ order: result.order, items: result.items });
      } else if (result.transitioned === 'cancelled') {
        console.log(`Reconciliation: order ${row.orderNumber} cancelled (${status.status})`);
      } else if (result.transitioned === 'paid_after_cancellation') {
        // The order was cancelled between our select and this call (a racing
        // webhook or operator) and the money landed anyway — same alert the
        // webhook route raises: a person has to refund.
        console.error(`Reconciliation: payment received for cancelled order ${row.orderNumber}`);
        await notifier.paymentAfterCancellation({ order: result.order, items: result.items });
      }
      // 'unchanged' (created/processing/hold): the invoice is still live —
      // the next sweep will find the order again, still reservation-less.
    } catch (err) {
      // One unreachable invoice must not stall the rest of the sweep; the
      // order stays `awaiting_payment` and the next sweep retries it.
      console.error(`Reconciliation failed for invoice ${row.invoiceId}`, err);
    }
  }
}

async function syncNovaPoshta(env: Env): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  const client = createNovaPoshtaClient(env.NOVAPOSHTA_API_KEY);
  const result = await syncNovaPoshtaReferenceData(client, db);
  console.log(
    `Nova Poshta sync: ${result.settlements} settlements, ${result.warehouses} warehouses, ` +
      `${result.retired} retired.`,
  );
}

/**
 * NP-4: order status follows the carrier, not a person. Every order with a
 * live waybill (see `listWaybillOrdersToTrack` for exactly which those are)
 * is asked about in one batched `TrackingDocument` call, and each answer is
 * applied in its own transaction by `applyCarrierStatus` — moves only ever
 * forward along `packed → shipped → delivered`, code 2 detaches a
 * cabinet-deleted waybill, every unhappy code is a Telegram alert and never
 * a transition, and an alert fires only the first tick its code appears.
 *
 * The network call happens before any transaction opens, and one failed
 * order never stalls the rest — the next tick retries whatever this one
 * missed, because the list query finds unresolved orders again by state, not
 * by memory.
 */
async function trackWaybillStatuses(env: Env): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  const tracked = await listWaybillOrdersToTrack(db);
  if (tracked.length === 0) return;

  const shipping = createNovaPoshtaShipping(env.NOVAPOSHTA_API_KEY);
  const statuses = await shipping.trackWaybills(tracked.map((row) => row.npTtn));
  const byNumber = new Map(statuses.map((status) => [status.number, status]));

  const notifier = createTelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
  const { db: txDb, close } = createTxDb(env.DATABASE_URL);

  try {
    for (const row of tracked) {
      const status = byNumber.get(row.npTtn);
      if (!status) continue; // NP answered nothing for this number this tick.

      try {
        const result = await applyCarrierStatus(txDb, row.orderNumber, status);
        if (!result.ok) continue; // Gone, or its waybill changed under us — skip.

        const { decision } = result;
        if (!decision.known) {
          console.warn(
            `Unknown NP status code ${status.statusCode} for order ${row.orderNumber}: ` +
              `${status.statusText}`,
          );
        }
        if (decision.move) {
          console.log(`Order ${row.orderNumber} → ${decision.move} (NP code ${status.statusCode})`);
        }
        if (decision.detach) {
          console.warn(`Order ${row.orderNumber}: waybill ${row.npTtn} deleted at NP, detached`);
        }
        if (decision.alert) {
          await notifier.carrierAlert({
            orderNumber: row.orderNumber,
            ttn: row.npTtn,
            alert: decision.alert,
            statusText: status.statusText,
          });
        }
      } catch (err) {
        // One failed order must not stall the sweep; the next tick retries it.
        console.error(`Carrier status apply failed for order ${row.orderNumber}`, err);
      }
    }
  } finally {
    await close();
  }
}
