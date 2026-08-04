import type { OrderStatus, PaymentMethod } from '~/lib/db/schema';

/**
 * The order state machine, as the admin panel is allowed to drive it.
 *
 * Pure on purpose: every rule about what may follow what, and about what that
 * costs inventory, lives here and is unit-tested, while `./updateStatus.ts`
 * stays thin plumbing around it. `docs/CONVENTIONS.md` fixes the shape —
 * transitions move forward through the list only, plus cancellation/refund:
 *
 *   pending → awaiting_payment → paid → packed → shipped → delivered
 *   pending → confirmed → packed → shipped → delivered     (cash on delivery)
 *
 * Two entries in that list are deliberately unreachable from here:
 *
 *  - **`paid` is never a legal target.** Only the Monobank webhook may set it
 *    (`docs/CONVENTIONS.md`, hard rule 2) — a button that marks an order paid is
 *    a button that forges a payment. There is a test asserting no reachable
 *    state offers it.
 *  - **`awaiting_payment` and `confirmed` are never targets either.** They are
 *    written by `./create.ts` as part of placing the order; there is nothing for
 *    an operator to do that should produce them afterwards.
 */

/**
 * Statuses at which the sale is already committed against inventory:
 * `productVariants.stock` has been decremented and the reservation deleted.
 *
 * Cash on delivery commits at creation (`./create.ts` — there is no payment to
 * wait on), card commits in the webhook (`./confirmPayment.ts`). Anything before
 * that holds a live `stock_reservations` row instead and has decremented
 * nothing, which is the whole reason this set exists: undoing an order must put
 * units back exactly when they were taken out, and never otherwise.
 */
const STOCK_COMMITTED: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'confirmed',
  'paid',
  'packed',
  'shipped',
  'delivered',
]);

export function isStockCommitted(status: OrderStatus): boolean {
  return STOCK_COMMITTED.has(status);
}

/** Nothing follows these. */
const TERMINAL: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['cancelled', 'refunded']);

/** The single step forward from each status, or `null` where the panel has none. */
const FORWARD: Readonly<Record<OrderStatus, OrderStatus | null>> = {
  pending: null,
  awaiting_payment: null,
  paid: 'packed',
  confirmed: 'packed',
  packed: 'shipped',
  shipped: 'delivered',
  delivered: null,
  cancelled: null,
  refunded: null,
};

/**
 * Has the customer's money actually reached us at this point?
 *
 * Card is taken up front, so it has from `paid` onward. Cash on delivery is
 * collected by the carrier when the parcel is handed over, so it has only at
 * `delivered` — which is why a cash order in transit is *cancelled*, not
 * refunded: there is nothing to refund.
 */
function moneyCollected(status: OrderStatus, paymentMethod: PaymentMethod): boolean {
  if (paymentMethod === 'cod') return status === 'delivered';
  return status === 'paid' || status === 'packed' || status === 'shipped' || status === 'delivered';
}

/**
 * What an operator may do to this order, in the order the buttons should read:
 * the step forward first, then the way out.
 *
 * The way out is exactly one of the two, decided by whether money has changed
 * hands — an order that was never paid for cannot be *refunded*, and an order
 * that was paid for must not be quietly *cancelled* with the money still held.
 * Both return committed stock; see `isStockCommitted`.
 */
export function allowedTransitions(order: {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
}): readonly OrderStatus[] {
  if (TERMINAL.has(order.status)) return [];

  const forward = FORWARD[order.status];
  const exit: OrderStatus = moneyCollected(order.status, order.paymentMethod)
    ? 'refunded'
    : 'cancelled';

  return forward ? [forward, exit] : [exit];
}

export function canTransition(
  order: { status: OrderStatus; paymentMethod: PaymentMethod },
  next: OrderStatus,
): boolean {
  return allowedTransitions(order).includes(next);
}
