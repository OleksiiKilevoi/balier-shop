import * as Sentry from '@sentry/cloudflare';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db, TxDb } from '../db';
import type { Order, OrderStatus } from '../db/schema';
import { orderItems, orders, payments, productVariants, stockReservations } from '../db/schema';
import type { PaymentPort } from '../ports';
import { allowedTransitions, isStockCommitted, orderDetailsLock } from './status';
import type { OrderDetailsLock } from './status';

/**
 * The admin panel's write path for an order.
 *
 * Deliberately thin: every rule about *what* may happen lives in `./status.ts`,
 * where it is pure and tested. What is here is the part that has to be
 * transactional — re-reading the row under a lock, and keeping inventory
 * honest both when an order is undone and when that undo is itself undone.
 *
 * Note what this file cannot do: it never independently decides an order is
 * `paid` — `allowedTransitions` only ever offers `paid` as a *revert* target
 * (restoring a status the Monobank webhook already set), never as a fresh
 * one, so there is still no path from here to the transition
 * `docs/CONVENTIONS.md` reserves for the webhook.
 */

export type UpdateOrderStatusResult =
  | { ok: true; order: Order }
  /** The row moved (or was never in `from`) since the page was rendered. */
  | { ok: false; reason: 'stale'; order: Order }
  | { ok: false; reason: 'invalid_transition'; order: Order }
  /**
   * Reverting out of `cancelled`/`refunded` re-commits the stock that exit
   * put back — refused, whole transaction, rather than oversold, if any of
   * it has since been sold to someone else.
   */
  | { ok: false; reason: 'insufficient_stock'; order: Order }
  | { ok: false; reason: 'not_found' };

export async function updateOrderStatus(
  txDb: TxDb,
  input: { orderNumber: string; from: OrderStatus; next: OrderStatus },
): Promise<UpdateOrderStatusResult> {
  return txDb.transaction(async (tx) => {
    // `FOR UPDATE`: two clicks on the same button — or two operators on the
    // same order — would otherwise both read `paid`, both pass the check, and
    // both apply their side effects.
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, input.orderNumber))
      .for('update')
      .limit(1);

    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status !== input.from) return { ok: false, reason: 'stale', order };
    if (!allowedTransitions(order).includes(input.next)) {
      return { ok: false, reason: 'invalid_transition', order };
    }

    const enteringExit = input.next === 'cancelled' || input.next === 'refunded';
    const leavingExit = order.status === 'cancelled' || order.status === 'refunded';

    if (enteringExit) {
      // Put the units back exactly when they were taken out, and never
      // otherwise: an order that still holds a reservation has decremented
      // nothing, so restocking it would invent stock that does not exist.
      if (isStockCommitted(order.status)) {
        const items = await tx
          .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));

        for (const item of items) {
          await tx
            .update(productVariants)
            .set({
              stock: sql`${productVariants.stock} + ${item.quantity}`,
              updatedAt: sql`now()`,
            })
            .where(eq(productVariants.id, item.variantId));
        }
      }

      // A no-op past the committed statuses, which dropped their reservations
      // when they committed — but the pre-payment ones still hold live rows,
      // and leaving them would keep stock spoken for by a dead order until the
      // TTL cron got round to it.
      await tx.delete(stockReservations).where(eq(stockReservations.orderId, order.id));
    } else if (leavingExit) {
      // The mirror image of the block above: `statusBeforeExit` is only ever
      // offered as `next` when it is `STOCK_COMMITTED` (`revertTarget`), so
      // re-decrementing is always the right move — but the units that were
      // put back may since have been sold to someone else. Lock and check
      // every row first; refuse the whole revert if even one is short,
      // rather than oversell.
      const items = await tx
        .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      const variants = await tx
        .select({ id: productVariants.id, stock: productVariants.stock })
        .from(productVariants)
        .where(
          inArray(
            productVariants.id,
            items.map((item) => item.variantId),
          ),
        )
        .for('update');

      const stockById = new Map(variants.map((variant) => [variant.id, variant.stock]));
      const insufficient = items.some(
        (item) => (stockById.get(item.variantId) ?? 0) < item.quantity,
      );
      if (insufficient) return { ok: false, reason: 'insufficient_stock', order };

      for (const item of items) {
        await tx
          .update(productVariants)
          .set({
            stock: sql`${productVariants.stock} - ${item.quantity}`,
            updatedAt: sql`now()`,
          })
          .where(eq(productVariants.id, item.variantId));
      }
    }

    const [updated] = await tx
      .update(orders)
      .set({
        status: input.next,
        // Records the fact a revert restores, and clears it back to `null`
        // once restored — see `orders.statusBeforeExit`'s own doc.
        ...(enteringExit ? { statusBeforeExit: order.status } : {}),
        ...(leavingExit ? { statusBeforeExit: null } : {}),
        // There is no `refundedAt` column, and inventing one for this would be a
        // schema change; `updatedAt` carries the time of a refund.
        ...(input.next === 'cancelled' ? { cancelledAt: sql`now()` } : {}),
        ...(leavingExit && order.status === 'cancelled' ? { cancelledAt: null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(orders.id, order.id))
      .returning();

    if (!updated) throw new Error('order update returned no row');

    return { ok: true, order: updated };
  });
}

/** Provider statuses whose payment link may still accept money. */
const LIVE_INVOICE_STATUSES = new Set(['created', 'processing', 'hold']);

/**
 * The follow-up to cancelling a not-yet-paid card order: invalidate its
 * Monobank invoice so the payment link dies with the order. Without this the
 * link stays payable until its own validity runs out, and a customer holding
 * it can pay a cancelled order — which lands in `confirmPayment`'s
 * `paid_after_cancellation` alert, a refund conversation this call exists to
 * prevent.
 *
 * Best-effort by design, called via `waitUntil` after the transition has
 * already committed: a removal Monobank refuses (or a network failure) leaves
 * only the shrinking window the invoice's own validity closes anyway, so it is
 * logged, never surfaced to the operator as a failed cancellation.
 */
export async function removeCancelledOrderInvoices(
  db: Db,
  payment: PaymentPort,
  orderId: string,
): Promise<void> {
  const rows = await db
    .select({ invoiceId: payments.invoiceId, status: payments.status })
    .from(payments)
    .where(eq(payments.orderId, orderId));

  for (const row of rows) {
    if (!LIVE_INVOICE_STATUSES.has(row.status)) continue;
    try {
      await payment.removeInvoice(row.invoiceId);
    } catch (err) {
      // The cancelled order's invoice is still payable (`sentry.md`).
      console.error(`Failed to remove Monobank invoice ${row.invoiceId}`, err);
      Sentry.captureException(err);
    }
  }
}

/**
 * The customer's facts, as `/orders/[n]/edit` may rewrite them. `delivery`
 * absent means "leave the delivery columns alone" — the contact-only save a
 * legacy courier order gets when its picker was never touched.
 */
export interface OrderDetailsPatch {
  customerName: string;
  customerPhone: string;
  /** `null` clears a stored address — the field is optional at checkout too. */
  customerEmail: string | null;
  delivery?: {
    deliveryMethod: 'np_warehouse' | 'np_postomat';
    npSettlementRef: string;
    npSettlementName: string;
    npWarehouseRef: string;
    npWarehouseName: string;
  };
}

export type UpdateOrderDetailsResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: OrderDetailsLock };

/**
 * Rewrites who the order is for and where it goes. The *when* lives in
 * `./status.ts` (`orderDetailsLock`) and is re-checked here under the same
 * `FOR UPDATE` the status writes take: the page's own check ran against a
 * render that may be minutes old, and a waybill created from a second tab in
 * between must win — the parcel it describes is real.
 */
export async function updateOrderDetails(
  txDb: TxDb,
  orderNumber: string,
  patch: OrderDetailsPatch,
): Promise<UpdateOrderDetailsResult> {
  return txDb.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .for('update')
      .limit(1);

    if (!order) return { ok: false, reason: 'not_found' };

    const lock = orderDetailsLock(order);
    if (lock) return { ok: false, reason: lock };

    const [updated] = await tx
      .update(orders)
      .set({
        customerName: patch.customerName,
        customerPhone: patch.customerPhone,
        customerEmail: patch.customerEmail,
        // A picked branch replaces the whole destination, including a legacy
        // courier street address — half-updated delivery columns would name a
        // branch in one city and a doorstep in another.
        ...(patch.delivery ? { ...patch.delivery, npAddress: null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(orders.id, order.id))
      .returning();

    if (!updated) throw new Error('order details update returned no row');

    return { ok: true, order: updated };
  });
}
