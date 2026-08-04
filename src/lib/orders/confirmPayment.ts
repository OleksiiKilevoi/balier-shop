import { eq, sql } from 'drizzle-orm';
import type { TxDb } from '~/lib/db';
import { findPaymentByInvoiceId } from '~/lib/db/queries/orders';
import { orders, payments, productVariants, stockReservations } from '~/lib/db/schema';
import type { Kopiykas } from '~/lib/money';
import type { InvoiceStatus } from '~/lib/ports';

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
  | { ok: true; transitioned: 'paid' | 'cancelled' | 'unchanged' }
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
      return { ok: true, transitioned: 'unchanged' };
    }

    if (statusResult.status === 'success') {
      await tx
        .update(payments)
        .set({ status: 'success', amount: statusResult.amount, lastPayload: rawPayload, updatedAt: sql`now()` })
        .where(eq(payments.id, payment.id));

      await tx
        .update(orders)
        .set({ status: 'paid', paidAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(orders.id, order.id));

      for (const item of order.items) {
        await tx
          .update(productVariants)
          .set({ stock: sql`${productVariants.stock} - ${item.quantity}`, updatedAt: sql`now()` })
          .where(eq(productVariants.id, item.variantId));
      }

      await tx.delete(stockReservations).where(eq(stockReservations.orderId, order.id));

      return { ok: true, transitioned: 'paid' };
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
