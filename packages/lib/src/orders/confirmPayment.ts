import { eq, sql } from 'drizzle-orm';
import type { TxDb } from '../db';
import { findPaymentByInvoiceId } from '../db/queries/orders';
import type { Order, OrderItem } from '../db/schema';
import { orders, payments, productVariants, stockReservations } from '../db/schema';
import type { Kopiykas } from '../money';
import type { InvoiceStatus } from '../ports';

/**
 * The webhook's transactional core — the *only* place an order becomes
 * `paid` (`docs/CONVENTIONS.md`). Called after the webhook route has already
 * verified `X-Sign` and re-checked the invoice status straight from Monobank;
 * this function never trusts anything about `status` that didn't come from
 * that re-check.
 *
 * Idempotent: a redelivered webhook for an order that already left `pending`/
 * `awaiting_payment` is a no-op, so a retried delivery never double-decrements
 * stock or re-fires a transition.
 */

export type ConfirmPaymentResult =
  /**
   * The order *just* became paid — carries the post-update row and its items so
   * the caller can notify without re-reading, and, more importantly, outside
   * this function's transaction (a network call must never hold one open). Only
   * ever returned once per order: a redelivered webhook lands on `unchanged`.
   */
  | { ok: true; transitioned: 'paid'; order: Order; items: readonly OrderItem[] }
  /**
   * Monobank reports `success` for an order that is already `cancelled` — the
   * customer paid in the gap between cancellation and this call (a late
   * webhook after the TTL sweep, or a payment link that outlived an admin
   * cancel). The order is deliberately NOT resurrected: its stock may be sold,
   * its cancellation may have been communicated. What must happen instead is a
   * refund, and that takes a person — the caller alerts the manager. Returned
   * once per order, same idempotency as `paid`: the payment row's own `success`
   * marks the alert as already raised.
   */
  | { ok: true; transitioned: 'paid_after_cancellation'; order: Order; items: readonly OrderItem[] }
  | { ok: true; transitioned: 'cancelled' | 'unchanged' }
  | { ok: false; reason: 'invoice_not_found' };

const TERMINAL_STATUSES = new Set(['paid', 'cancelled', 'refunded']);
const FAILURE_STATUSES = new Set<InvoiceStatus>(['failure', 'reversed', 'expired']);

export async function confirmPayment(
  txDb: TxDb,
  invoiceId: string,
  statusResult: { status: InvoiceStatus; amount: Kopiykas },
  rawPayload: unknown,
): Promise<ConfirmPaymentResult> {
  return txDb.transaction(async (tx) => {
    const payment = await findPaymentByInvoiceId(tx, invoiceId);
    if (!payment) return { ok: false, reason: 'invoice_not_found' };

    const order = payment.order;
    if (TERMINAL_STATUSES.has(order.status)) {
      // Money on a cancelled order is the one terminal case that must not pass
      // silently. Recording `success` on the payment row does double duty: the
      // admin order page shows Monobank's side of the disagreement, and a
      // redelivered webhook sees it already recorded and stays quiet.
      if (order.status === 'cancelled' && statusResult.status === 'success') {
        if (payment.status === 'success') return { ok: true, transitioned: 'unchanged' };

        await tx
          .update(payments)
          .set({ status: 'success', amount: statusResult.amount, lastPayload: rawPayload, updatedAt: sql`now()` })
          .where(eq(payments.id, payment.id));

        return { ok: true, transitioned: 'paid_after_cancellation', order, items: order.items };
      }

      return { ok: true, transitioned: 'unchanged' };
    }

    if (statusResult.status === 'success') {
      await tx
        .update(payments)
        .set({ status: 'success', amount: statusResult.amount, lastPayload: rawPayload, updatedAt: sql`now()` })
        .where(eq(payments.id, payment.id));

      const [paidOrder] = await tx
        .update(orders)
        .set({ status: 'paid', paidAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(orders.id, order.id))
        .returning();

      if (!paidOrder) throw new Error('order update returned no row');

      for (const item of order.items) {
        await tx
          .update(productVariants)
          .set({ stock: sql`${productVariants.stock} - ${item.quantity}`, updatedAt: sql`now()` })
          .where(eq(productVariants.id, item.variantId));
      }

      await tx.delete(stockReservations).where(eq(stockReservations.orderId, order.id));

      return { ok: true, transitioned: 'paid', order: paidOrder, items: order.items };
    }

    if (FAILURE_STATUSES.has(statusResult.status)) {
      await tx
        .update(payments)
        .set({ status: statusResult.status, lastPayload: rawPayload, updatedAt: sql`now()` })
        .where(eq(payments.id, payment.id));

      await tx
        .update(orders)
        .set({ status: 'cancelled', cancelledAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(orders.id, order.id));

      await tx.delete(stockReservations).where(eq(stockReservations.orderId, order.id));

      return { ok: true, transitioned: 'cancelled' };
    }

    // processing / hold / created — still waiting, nothing to transition yet.
    await tx
      .update(payments)
      .set({ status: statusResult.status, lastPayload: rawPayload, updatedAt: sql`now()` })
      .where(eq(payments.id, payment.id));

    return { ok: true, transitioned: 'unchanged' };
  });
}
