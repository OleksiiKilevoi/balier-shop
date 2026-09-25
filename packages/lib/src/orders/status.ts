import type { OrderStatus, PaymentMethod } from '../db/schema';

/**
 * The order state machine. Pure on purpose: every rule about what may follow
 * what, and about what that costs inventory, lives here and is unit-tested,
 * while `./updateStatus.ts` stays thin plumbing around it. The shape:
 *
 *   pending → awaiting_payment → paid → packed → shipped → arrived → delivered
 *   pending → confirmed → packed → shipped → arrived → delivered   (cash on delivery)
 *
 * **The forward chain is not the panel's to drive** (`docs/plans/novaposhta.md`,
 * NP-4). Each forward step has exactly one owner, and none of them is a status
 * button: only the Monobank webhook sets `paid` (`docs/CONVENTIONS.md`, hard
 * rule 2), only `./create.ts` sets `confirmed` when the order is placed, only
 * creating a waybill sets `packed` (`./waybill.ts` — the act of packing *is*
 * the waybill), and only the carrier's own tracking moves `packed → shipped →
 * arrived → delivered` (`./applyCarrierStatus.ts`, fed by the cron;
 * `carrierCanAdvance` below is its rule). What the panel keeps is the way
 * *out* — cancel or refund — and the way back out of those. An order shipped
 * outside Nova Poshta therefore has no path forward at all; that risk was
 * raised and accepted knowingly unmitigated — the stuck-order alert built for
 * it was removed at the client's request (docs/plans/novaposhta.md,
 * «Decisions»).
 *
 * `paid` and `confirmed` remain legal **revert** targets from exactly one
 * place: deleting `packed`'s waybill (`./waybill.ts` via `revertTarget`). A
 * card order can only have reached `packed` through the webhook's `paid`, a
 * cash order only through `create.ts`'s `confirmed`, so reverting `packed` is
 * never inventing a status — it restores the one that got the order there,
 * picked by `paymentMethod` since the two payment methods diverge at exactly
 * this point. `awaiting_payment` and `pending` stay unreachable in every
 * direction: nothing before `paid`/`confirmed` is ever revertable, because
 * the panel has no earlier foothold to restore from.
 *
 * `cancelled` and `refunded` are terminal to *forward* progress, but they too
 * have exactly one legal way back: `orders.statusBeforeExit`
 * (`~/lib/db/schema.ts`), written by `./updateStatus.ts` whenever the panel
 * moves an order into either, records the status it actually held a moment
 * before. Reverting restores that recorded fact, and only when it is one of
 * `LIVE_SALE` — a cancellation/refund from `pending`/`awaiting_payment`
 * (never done by this panel, but done elsewhere on a payment failure; see
 * `./create.ts`/`./confirmPayment.ts`) has no useful status to go back to,
 * for the same reason those two are never forward-revertable either.
 */

/**
 * The statuses an order reaches as a *live* sale: cash on delivery at creation
 * (`./create.ts` — there is no payment to wait on), card at the webhook
 * (`./confirmPayment.ts`), and everything downstream of those.
 *
 * `pending` and `awaiting_payment` are outside it because they are not an
 * agreement yet, only an attempt at one — which is why an order cancelled from
 * either has nothing worth restoring and `revertTarget` below offers no way
 * back to them.
 *
 * This set was called `STOCK_COMMITTED` until 2026-08-10 and meant «the units
 * have been decremented»; it survived the removal of the stock count because
 * the line it draws — attempt versus sale — was never really about inventory.
 */
const LIVE_SALE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'confirmed',
  'paid',
  'packed',
  'shipped',
  'arrived',
  'delivered',
]);

/** Nothing follows these by *forward* progress — but see `revertTarget`. */
const TERMINAL: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['cancelled', 'refunded']);

/**
 * The slice of the chain the carrier owns, in travel order. `packed` is where
 * a waybill starts and `delivered` is where it ends; nothing outside these
 * three is ever the carrier's to touch — not `paid` (webhook-only, hard rule
 * 2), not the terminal statuses (human-only, by the same NP-4 decision that
 * removed the forward buttons).
 */
const CARRIER_CHAIN: readonly OrderStatus[] = ['packed', 'shipped', 'arrived', 'delivered'];

/** The statuses only tracking ever produces — `CARRIER_CHAIN` minus its start. */
export type CarrierMove = 'shipped' | 'arrived' | 'delivered';

/**
 * May tracking move this order to `next`? Strictly forward along
 * `packed → shipped → arrived → delivered`, and skipping is allowed on
 * purpose: a 15-minute tick can easily miss the in-transit or branch-arrival
 * code and first see «отримано», and the parcel being handed over is better
 * evidence of `delivered` than our having witnessed every hop on the way.
 */
export function carrierCanAdvance(current: OrderStatus, next: CarrierMove): boolean {
  const from = CARRIER_CHAIN.indexOf(current);
  return from !== -1 && CARRIER_CHAIN.indexOf(next) > from;
}

/**
 * Has the customer's money actually reached us at this point?
 *
 * Card is taken up front, so it has from `paid` onward. Cash on delivery is
 * collected by the carrier when the parcel is handed over, so it has only at
 * `delivered` («Отримано») — not at `arrived`: a COD parcel sitting at the
 * branch is still just a parcel, which is why a cash order anywhere short of
 * the handover is *cancelled*, not refunded: there is nothing to refund.
 */
function moneyCollected(status: OrderStatus, paymentMethod: PaymentMethod): boolean {
  if (paymentMethod === 'cod') return status === 'delivered';
  // «Покупка Частинами»: `paid` is the client's approval; nothing is debited
  // until the hand-over confirm, which the waybill (`packed`) sends. So `paid`
  // is cancelled (the application withdrawn), not refunded.
  // ponytail: a waybill deleted after that confirm puts the order back at
  // `paid` with the plan already running — its cancel is then a return in
  // the monobank cabinet; the payment row's `confirmed` shows it.
  if (paymentMethod === 'parts' && status === 'paid') return false;
  return (
    status === 'paid' ||
    status === 'packed' ||
    status === 'shipped' ||
    status === 'arrived' ||
    status === 'delivered'
  );
}

/**
 * What every function below needs to know about an order.
 * `statusBeforeExit` only matters — and is only ever read — while `status` is
 * `cancelled`/`refunded`; it is safe to omit anywhere else.
 */
export interface OrderStateInput {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  statusBeforeExit?: OrderStatus | null;
}

/**
 * The single step backward from each status, or `null` where undoing is not
 * offered.
 *
 * `packed`'s target depends on `paymentMethod` — see the module doc: a card
 * order's only path to `packed` was through the webhook's `paid`, a cash
 * order's only path was through `create.ts`'s `confirmed`, and reverting
 * restores whichever one actually happened rather than guessing. `shipped`,
 * `arrived` and `delivered` don't need the split — both payment methods reach
 * them through the same tail of the chain. `cancelled`/`refunded` revert
 * to whatever `statusBeforeExit` recorded, but only when that recording is
 * itself a `LIVE_SALE` status — the same eligibility rule that keeps
 * `pending`/`awaiting_payment` unreachable everywhere else in this module.
 */
export function revertTarget(order: OrderStateInput): OrderStatus | null {
  switch (order.status) {
    case 'packed':
      return order.paymentMethod === 'cod' ? 'confirmed' : 'paid';
    case 'shipped':
      return 'packed';
    case 'arrived':
      return 'shipped';
    case 'delivered':
      return 'arrived';
    case 'cancelled':
    case 'refunded': {
      // A cancelled «частинами» order withdrew its application at monobank;
      // putting it back to `paid` would claim an approval that no longer exists.
      if (order.paymentMethod === 'parts' && order.status === 'cancelled') return null;
      const prior = order.statusBeforeExit;
      return prior && LIVE_SALE.has(prior) ? prior : null;
    }
    default:
      return null;
  }
}

/**
 * What an operator may do to this order. Since NP-4 that is only the way out:
 * cancel or refund, exactly one of the two, decided by whether money has
 * changed hands — an order that was never paid for cannot be *refunded*, and
 * an order that was paid for must not be quietly *cancelled* with the money
 * still held. Neither touches availability — that is the manager's flag on the
 * variant, and an undone order is not evidence about it either way.
 *
 * No forward steps (each has its one non-panel owner — see the module doc)
 * and no forward-chain reverts either: undoing `packed` is deleting its
 * waybill, and un-marking `shipped`/`delivered` by hand would just be
 * re-applied by the next tracking tick — a button that fights the cron is
 * worse than no button. `cancelled`/`refunded` are the one case where the
 * step back is the *only* thing on offer — there is no forward step and no
 * further exit from a terminal status, only (maybe) undoing the exit itself.
 */
export function allowedTransitions(order: OrderStateInput): readonly OrderStatus[] {
  if (TERMINAL.has(order.status)) {
    const back = revertTarget(order);
    return back ? [back] : [];
  }

  return [moneyCollected(order.status, order.paymentMethod) ? 'refunded' : 'cancelled'];
}

/**
 * Statuses at which the customer's own facts — name, phone, email, where the
 * parcel goes — are still the panel's to correct. Everything up to and
 * including `packed`: the parcel exists but has not moved. From `shipped` on
 * the data already travelled with it, and the terminal statuses describe an
 * order that is over either way.
 */
const DETAILS_EDITABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'pending',
  'awaiting_payment',
  'paid',
  'confirmed',
  'packed',
]);

/**
 * Why the customer/delivery details may not be edited right now, or `null`
 * when they may.
 *
 * The waybill outranks the status: a ТТН — panel-made or hand-entered — is a
 * carrier document carrying the recipient's name, phone and destination, and
 * an order edited underneath it would quietly disagree with the parcel. The
 * way through is the one the message names: delete the ТТН, edit, recreate.
 */
export type OrderDetailsLock = 'edit_ttn_exists' | 'edit_locked';

export function orderDetailsLock(order: {
  status: OrderStatus;
  npTtn: string | null;
}): OrderDetailsLock | null {
  if (order.npTtn !== null) return 'edit_ttn_exists';
  return DETAILS_EDITABLE.has(order.status) ? null : 'edit_locked';
}
