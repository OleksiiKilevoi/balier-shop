import { eq, sql } from 'drizzle-orm';
import type { Db, TxDb } from '~/lib/db';
import type { Order, OrderStatus } from '~/lib/db/schema';
import { orderItems, orders, productVariants, stockReservations } from '~/lib/db/schema';
import { allowedTransitions, isStockCommitted } from './status';

/**
 * The admin panel's write path for an order.
 *
 * Deliberately thin: every rule about *what* may happen lives in `./status.ts`,
 * where it is pure and tested. What is here is the part that has to be
 * transactional — re-reading the row under a lock, and keeping inventory
 * honest when an order is undone.
 *
 * Note what this file cannot do: `allowedTransitions` never yields `paid`, so
 * there is no path from the panel to the transition `docs/CONVENTIONS.md`
 * reserves for the Monobank webhook.
 */

export type UpdateOrderStatusResult =
  | { ok: true; order: Order }
  /** The row moved (or was never in `from`) since the page was rendered. */
  | { ok: false; reason: 'stale'; order: Order }
  | { ok: false; reason: 'invalid_transition'; order: Order }
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

    const undoing = input.next === 'cancelled' || input.next === 'refunded';

    if (undoing) {
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
    }

    const [updated] = await tx
      .update(orders)
      .set({
        status: input.next,
        // There is no `refundedAt` column, and inventing one for this would be a
        // schema change; `updatedAt` carries the time of a refund.
        ...(input.next === 'cancelled' ? { cancelledAt: sql`now()` } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(orders.id, order.id))
      .returning();

    if (!updated) throw new Error('order update returned no row');

    return { ok: true, order: updated };
  });
}

/**
 * The Nova Poshta tracking number, typed in by whoever created the parcel.
 * Plain single-row write with no transaction and no state machine behind it —
 * it annotates an order, it does not move one. `null` clears it.
 */
export async function setOrderTrackingNumber(
  db: Db,
  orderNumber: string,
  ttn: string | null,
): Promise<Order | null> {
  const [updated] = await db
    .update(orders)
    .set({ npTtn: ttn, updatedAt: sql`now()` })
    .where(eq(orders.orderNumber, orderNumber))
    .returning();

  return updated ?? null;
}
