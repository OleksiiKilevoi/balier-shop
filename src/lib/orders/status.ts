import type { OrderStatus, PaymentMethod } from '~/lib/db/schema';

/**
 * The order state machine, as the admin panel is allowed to drive it.
 *
 * Pure on purpose: every rule about what may follow what, and about what that
 * costs inventory, lives here and is unit-tested, while `./updateStatus.ts`
 * stays thin plumbing around it. `docs/CONVENTIONS.md` fixes the shape —
 * transitions move forward through the list, one step back, or out via
 * cancellation/refund:
 *
 *   pending → awaiting_payment → paid → packed → shipped → delivered
 *   pending → confirmed → packed → shipped → delivered     (cash on delivery)
 *
 * Two entries in that list are deliberately unreachable from here, in either
 * direction:
 *
 *  - **`paid` is never a legal target.** Only the Monobank webhook may set it
 *    (`docs/CONVENTIONS.md`, hard rule 2) — a button that marks an order paid is
 *    a button that forges a payment. There is a test asserting no reachable
 *    state offers it.
 *  - **`awaiting_payment` and `confirmed` are never targets either.** They are
 *    written by `./create.ts` as part of placing the order; there is nothing for
 *    an operator to do that should produce them afterwards.
 *
 * That is why undoing a wrong click (`revertTarget`) only goes as far back as
 * `packed`: `shipped → packed` and `delivered → shipped` are both statuses the
 * panel itself set, so stepping back onto one is admitting a mistake, not
 * producing anything new. `packed` itself has no revert target — its
 * predecessor is `paid` or `confirmed`, both off-limits for the reasons above.
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
 * The single step backward from each status, or `null` where undoing is not
 * offered. Deliberately shallow — see the module doc for why `packed` has no
 * entry: its predecessor is `paid` or `confirmed`, and the panel may never
 * produce either.
 *
 * Depends only on `status`, not `paymentMethod`: both payment methods reach
 * `shipped`/`delivered` through the same last two links of the chain.
 */
export function revertTarget(status: OrderStatus): OrderStatus | null {
  switch (status) {
    case 'shipped':
      return 'packed';
    case 'delivered':
      return 'shipped';
    default:
      return null;
  }
}

/**
 * True when stepping back one status would flip "has the money arrived?" from
 * yes to no. In practice this is only cash on delivery's `delivered → shipped`:
 * money lands when the carrier hands the parcel over, so undoing that admits
 * the order was never actually paid for — and the exit action offered next
 * silently changes from refund back to cancel. Card never crosses this,
 * because every status from `paid` on already counts as collected.
 *
 * Purely informational — `updateStatus.ts` does not consult this, since no
 * money or stock actually moves on a revert; it exists so the panel can warn
 * before the click rather than surprise the operator after it.
 */
export function revertCrossesPayment(order: {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
}): boolean {
  const target = revertTarget(order.status);
  if (!target) return false;
  return (
    moneyCollected(order.status, order.paymentMethod) && !moneyCollected(target, order.paymentMethod)
  );
}

/**
 * What an operator may do to this order, in the order the buttons should read:
 * the step forward first, then the step back, then the way out.
 *
 * The way out is exactly one of the two, decided by whether money has changed
 * hands — an order that was never paid for cannot be *refunded*, and an order
 * that was paid for must not be quietly *cancelled* with the money still held.
 * Both return committed stock; see `isStockCommitted`. The step back returns
 * neither — it only ever moves within `STOCK_COMMITTED`, so nothing to put
 * back or release either way (see `revertTarget`'s doc for why it never goes
 * further than `packed`).
 */
export function allowedTransitions(order: {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
}): readonly OrderStatus[] {
  if (TERMINAL.has(order.status)) return [];

  const forward = FORWARD[order.status];
  const back = revertTarget(order.status);
  const exit: OrderStatus = moneyCollected(order.status, order.paymentMethod)
    ? 'refunded'
    : 'cancelled';

  return [forward, back, exit].filter((next): next is OrderStatus => next !== null);
}

export function canTransition(
  order: { status: OrderStatus; paymentMethod: PaymentMethod },
  next: OrderStatus,
): boolean {
  return allowedTransitions(order).includes(next);
}
