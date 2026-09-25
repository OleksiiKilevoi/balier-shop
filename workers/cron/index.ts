import * as Sentry from '@sentry/cloudflare';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { createDb, createTxDb } from '@balier/lib/db';
import { pruneAuthAttempts } from '@balier/lib/db/queries/authAttempts';
import { listWaybillOrdersToTrack } from '@balier/lib/db/queries/orders';
import { claimReviewRequest } from '@balier/lib/db/queries/reviews';
import { getPaymentTtlMinutes } from '@balier/lib/db/queries/settings';
import { orders, payments } from '@balier/lib/db/schema';
import { createMonobankPayment } from '@balier/lib/monobank';
import { monoPartsFromEnv } from '@balier/lib/monoparts';
import { createEmailNotifier, sendReviewRequestEmail } from '@balier/lib/notify/email';
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
 *
 * The jobs are awaited rather than handed to `ctx.waitUntil` — a rejection
 * inside a waitUntil promise never reaches the Sentry wrapper (or the
 * invocation's own failure status), it only dies in the runtime's logs. The
 * lifetime is the same either way; only the error path moved. With two jobs
 * on one trigger, `allSettled` keeps one job's failure from hiding the
 * other's run, and the first rejection is rethrown so the wrapper reports it.
 */
const handler = {
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    switch (event.cron) {
      // Every 15 minutes — close out orders that were never paid, and follow
      // every live waybill's carrier status (NP-4).
      case '*/15 * * * *': {
        const results = await Promise.allSettled([
          sweepUnpaidOrders(env),
          trackWaybillStatuses(env),
        ]);
        const failed = results.find((r) => r.status === 'rejected');
        if (failed) throw failed.reason;
        break;
      }

      // 04:00 UTC daily — refresh the Nova Poshta settlement/warehouse cache,
      // and drop login-attempt rows whose window ran out a day ago.
      case '0 4 * * *':
        await syncNovaPoshta(env);
        await pruneAuthAttempts(createDb(env.DATABASE_URL)).catch((err) => {
          // Housekeeping: a failure here must not lose the sync above.
          console.error('Pruning auth attempts failed', err);
        });
        break;

      default:
        console.warn(`Unhandled cron trigger: ${event.cron}`);
    }
  },
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    // Stamped per deploy by `deploy.mjs` (`--var SENTRY_RELEASE:<sha>`) and
    // absent on a bare `wrangler deploy`. Unlike the Astro apps, whose maps
    // match by injected debug IDs, a wrangler bundle's maps match by release —
    // no release, no readable stack traces, everything else still works.
    release: env.SENTRY_RELEASE,
    // Errors only — no performance tracing.
    tracesSampleRate: 0,
    // One Sentry project for all three Workers; this tag tells them apart.
    initialScope: { tags: { worker: 'cron' } },
  }),
  handler,
);

/**
 * A payment window is meaningless without this: a card checkout that never
 * reaches payment would otherwise sit `pending`/`awaiting_payment` forever.
 * Cash on delivery is never found here — `createOrder` confirms it in the
 * transaction that creates it — so this only ever sees card orders that
 * stalled.
 *
 * The window is the order's own age against `payment_ttl_minutes`, the same
 * setting that stamps the invoice's validity. Until 2026-08-10 it was the
 * expiry on a `stock_reservations` row instead; the row went with the stock
 * count, the clock it carried did not.
 *
 * Two steps, deliberately unequal in caution:
 *
 * 1. **`pending` orders past the window are cancelled outright.** `pending`
 *    means the invoice was never recorded (`createOrder` moves to
 *    `awaiting_payment` in the same transaction that records it), so there is
 *    nothing to ask Monobank about.
 * 2. **`awaiting_payment` orders are never cancelled on our clock alone.**
 *    The customer may have paid in the invoice's final minute with the
 *    webhook still in flight — or the webhook may simply have been lost. So
 *    every `awaiting_payment` order past the window is *reconciled*: ask
 *    Monobank for the invoice's live status and let `confirmPayment` apply
 *    it — `paid` (with the notifications the webhook would have sent),
 *    cancelled on a definitive failure, or left alone until the invoice
 *    itself expires. This doubles as the recovery path for lost webhooks.
 */
async function sweepUnpaidOrders(env: Env): Promise<void> {
  // The setting is a plain read, so it goes over the HTTP driver; the sweep
  // itself needs the pooled one, because `confirmPayment` opens transactions.
  const ttlMinutes = await getPaymentTtlMinutes(createDb(env.DATABASE_URL));
  const { db, close } = createTxDb(env.DATABASE_URL);

  try {
    // Interpolated as a number into an interval expression — `ttlMinutes` is a
    // setting read back as a JSON number, never user text.
    const expired = sql`${orders.createdAt} < now() - make_interval(mins => ${ttlMinutes})`;

    await db
      .update(orders)
      .set({ status: 'cancelled', cancelledAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(orders.status, 'pending'), expired));

    await reconcileAwaitingPayment(env, db, expired);
  } finally {
    await close();
  }
}

/**
 * Step 2 above. Picks up every `awaiting_payment` order past the payment
 * window — this sweep's expiries and any stragglers a previous sweep left
 * `unchanged` (invoice still `processing`, or Monobank unreachable) — so an
 * order can never get stuck between sweeps. Network calls happen between
 * transactions, never inside one; `confirmPayment` is idempotent, so a webhook
 * racing this loop is harmless whichever lands first.
 */
async function reconcileAwaitingPayment(
  env: Env,
  db: ReturnType<typeof createTxDb>['db'],
  expired: SQL,
): Promise<void> {
  const stale = await db
    .select({ orderNumber: orders.orderNumber, invoiceId: payments.invoiceId, provider: payments.provider })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(and(eq(orders.status, 'awaiting_payment'), expired));

  if (stale.length === 0) return;

  const card = createMonobankPayment(env.MONOBANK_TOKEN);
  const parts = monoPartsFromEnv(env);
  const notifier = createTelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
  const email = createEmailNotifier(env.EMAIL, env.ORDER_EMAIL_FROM);

  for (const row of stale) {
    try {
      const payment = row.provider === 'monobank_parts' ? parts : card;
      // Keys removed while an application was open: leave it for a person.
      if (!payment) continue;
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
      } else if (result.transitioned === 'amount_mismatch') {
        console.error(`Reconciliation: paid amount does not match order ${row.orderNumber}`);
        Sentry.captureMessage(
          `Paid amount does not match order ${row.orderNumber} — left unpaid for review`,
          'error',
        );
      } else if (result.transitioned === 'paid_after_cancellation') {
        // The order was cancelled between our select and this call (a racing
        // webhook or operator) and the money landed anyway — same alert the
        // webhook route raises: a person has to refund.
        console.error(`Reconciliation: payment received for cancelled order ${row.orderNumber}`);
        Sentry.captureMessage(
          `Reconciliation: payment received for cancelled order ${row.orderNumber} — manual refund owed`,
          'error',
        );
        await notifier.paymentAfterCancellation({ order: result.order, items: result.items });
      }
      // 'unchanged' (created/processing/hold): the invoice is still live —
      // the next sweep will find the order again, still past the window.
    } catch (err) {
      // One unreachable invoice must not stall the rest of the sweep; the
      // order stays `awaiting_payment` and the next sweep retries it.
      console.error(`Reconciliation failed for invoice ${row.invoiceId}`, err);
      Sentry.captureException(err);
    }
  }
}

/**
 * The parcel was received: ask for a review, once per order. The claim is
 * stamped before the send, so a failed send is not retried — a missed «як вам
 * покупка?» costs nothing, a repeated one annoys. No e-mail on the order, no
 * letter; the manager can still copy the link from the order page.
 */
async function requestReview(env: Env, db: ReturnType<typeof createDb>, orderId: string) {
  const claim = await claimReviewRequest(db, orderId);
  if (!claim?.customerEmail) return;
  try {
    await sendReviewRequestEmail(env.EMAIL, env.ORDER_EMAIL_FROM, {
      to: claim.customerEmail,
      customerName: claim.customerName,
      reviewUrl: new URL(`/review/${claim.reviewToken}`, env.PUBLIC_SITE_URL).href,
    });
  } catch (err) {
    console.error(`Review request e-mail failed for order ${orderId}`, err);
    Sentry.captureException(err);
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
 * forward along `packed → shipped → arrived → delivered`, code 2 silently detaches a
 * cabinet-deleted waybill, every other unhappy code is a Telegram alert and
 * never a transition, and an alert fires only the first tick its code appears.
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
          Sentry.captureMessage(
            `Unknown NP status code ${status.statusCode}: ${status.statusText}`,
            'warning',
          );
        }
        if (decision.move) {
          console.log(`Order ${row.orderNumber} → ${decision.move} (NP code ${status.statusCode})`);
        }
        if (decision.move === 'delivered') await requestReview(env, db, result.order.id);
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
        Sentry.captureException(err);
      }
    }
  } finally {
    await close();
  }
}
