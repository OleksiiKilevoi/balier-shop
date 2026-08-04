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
 * `paid` and `confirmed` are never *forward* targets from here — only the
 * Monobank webhook may set `paid` (`docs/CONVENTIONS.md`, hard rule 2), and only
 * `./create.ts` sets `confirmed` when the order is placed. A button that
 * produced either as a fresh transition would be forging a payment or an order.
 *
 * They *are* legal **revert** targets, but only from exactly one place each,
 * because `FORWARD` maps both of them to `packed` and nothing else does: a
 * card order can only have reached `packed` by first passing through the
 * webhook's `paid`, and a cash order can only have reached `packed` by first
 * passing through `create.ts`'s `confirmed`. So `revertTarget('packed', …)`
 * is never inventing a status — it is restoring the one that got the order
 * there in the first place, picked by `paymentMethod` since the two payment
 * methods diverge at exactly this point. `awaiting_payment` and `pending`
 * stay unreachable in every direction: nothing before `paid`/`confirmed` is
 * ever revertable, because the panel has no earlier foothold to restore from.
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
 * offered.
 *
 * `packed`'s target depends on `paymentMethod` — see the module doc: a card
 * order's only path to `packed` was through the webhook's `paid`, a cash
 * order's only path was through `create.ts`'s `confirmed`, and reverting
 * restores whichever one actually happened rather than guessing. `shipped`
 * and `delivered` don't need the split — both payment methods reach them
 * through the same last two links of the chain.
 */
export function revertTarget(order: {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
}): OrderStatus | null {
  switch (order.status) {
    case 'packed':
      return order.paymentMethod === 'cod' ? 'confirmed' : 'paid';
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
  const target = revertTarget(order);
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
 * back or release either way (see `revertTarget`'s doc for how far back it
 * goes and why that's still safe for `paid`/`confirmed`).
 */
export function allowedTransitions(order: {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
}): readonly OrderStatus[] {
  if (TERMINAL.has(order.status)) return [];

  const forward = FORWARD[order.status];
  const back = revertTarget(order);
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
