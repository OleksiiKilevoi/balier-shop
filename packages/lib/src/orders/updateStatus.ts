import * as Sentry from '@sentry/cloudflare';
import { eq, sql } from 'drizzle-orm';
import type { Db, TxDb } from '../db';
import type { Order, OrderStatus } from '../db/schema';
import { orders, payments } from '../db/schema';
import type { PaymentPort } from '../ports';
import { allowedTransitions, orderDetailsLock } from './status';
import type { OrderDetailsLock } from './status';

/**
 * The admin panel's write path for an order.
 *
 * Deliberately thin: every rule about *what* may happen lives in `./status.ts`,
 * where it is pure and tested. What is here is the part that has to be
 * transactional — re-reading the row under a lock before writing it.
 *
 * Nothing here moves inventory. Cancelling used to put units back and
 * reverting a cancellation used to take them out again (refusing the revert
 * when they had since been sold); with availability a flag no order ever
 * writes, both halves went on 2026-08-10 — the manager decides what is in
 * stock, and a cancelled order does not.
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
 * A «частинами» application can still be withdrawn after the client approved
 * (`success`): nothing is debited until the hand-over confirm. Once confirmed,
 * cancelling is a return — a person's job in the monobank cabinet for now.
 */
const WITHDRAWABLE_PARTS_STATUSES = new Set([...LIVE_INVOICE_STATUSES, 'success']);

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
  ports: { monobank: PaymentPort; monobank_parts: PaymentPort | null },
  orderId: string,
): Promise<void> {
  const rows = await db
    .select({ invoiceId: payments.invoiceId, status: payments.status, provider: payments.provider })
    .from(payments)
    .where(eq(payments.orderId, orderId));

  for (const row of rows) {
    const payment = ports[row.provider];
    const withdrawable =
      row.provider === 'monobank_parts' ? WITHDRAWABLE_PARTS_STATUSES : LIVE_INVOICE_STATUSES;
    if (!payment || !withdrawable.has(row.status)) continue;
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

/**
 * The «частинами» hand-over: once the parcel is on its way, tell monobank the
 * goods were given, which activates the plan and takes the first payment.
 * Best-effort after the waybill committed; the payment row's `confirmed` is
 * what makes a second waybill (after a delete) not confirm twice, and what the
 * order page shows. A failure is left `success` for a person to retry.
 */
export async function confirmPartsHandover(
  db: Db,
  parts: { confirm(orderId: string): Promise<void> },
  orderId: string,
): Promise<void> {
  const rows = await db
    .select({ id: payments.id, invoiceId: payments.invoiceId, status: payments.status })
    .from(payments)
    .where(eq(payments.orderId, orderId));

  for (const row of rows) {
    if (row.status !== 'success') continue;
    try {
      await parts.confirm(row.invoiceId);
      await db
        .update(payments)
        .set({ status: 'confirmed', updatedAt: sql`now()` })
        .where(eq(payments.id, row.id));
    } catch (err) {
      console.error(`monobank parts confirm failed for ${row.invoiceId}`, err);
      Sentry.captureException(err);
    }
  }
}
