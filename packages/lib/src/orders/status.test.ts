import { describe, expect, it } from 'vitest';
import { orderStatus } from '../db/schema';
import type { OrderStatus, PaymentMethod } from '../db/schema';
import {
  allowedTransitions,
  canTransition,
  isStockCommitted,
  revertCrossesPayment,
  revertTarget,
} from './status';

/**
 * The admin panel's half of the order state machine. Worth testing on its own
 * because two of its rules are invisible at the call site and expensive to get
 * wrong: which target statuses the panel may never *produce as new* (`paid` —
 * the webhook is its only writer, except when a revert restores a `paid`/
 * `confirmed`/other `STOCK_COMMITTED` status the order already demonstrably
 * passed through), and when undoing an order has to move stock, in which
 * direction.
 */

const ALL_STATUSES = orderStatus.enumValues;
const METHODS: PaymentMethod[] = ['card', 'cod'];
const STOCK_COMMITTED_STATUSES: OrderStatus[] = [
  'confirmed',
  'paid',
  'packed',
  'shipped',
  'delivered',
];

function order(status: OrderStatus, paymentMethod: PaymentMethod, statusBeforeExit?: OrderStatus | null) {
  return { status, paymentMethod, statusBeforeExit };
}

describe('allowedTransitions', () => {
  it('offers `paid` in exactly one place among forward-chain statuses: reverting a card order out of `packed`', () => {
    // `docs/CONVENTIONS.md`: an order becomes paid only in the webhook handler.
    // This isn't the panel deciding an order is paid — a card order's only
    // forward path to `packed` was through the webhook's `paid`, so reverting
    // restores a status the order demonstrably already held.
    for (const status of STOCK_COMMITTED_STATUSES) {
      for (const method of METHODS) {
        const next = allowedTransitions(order(status, method));
        const shouldOffer = status === 'packed' && method === 'card';
        expect(next.includes('paid')).toBe(shouldOffer);
      }
    }
  });

  it('offers `confirmed` in exactly one place among forward-chain statuses: reverting a cash order out of `packed`', () => {
    for (const status of STOCK_COMMITTED_STATUSES) {
      for (const method of METHODS) {
        const next = allowedTransitions(order(status, method));
        const shouldOffer = status === 'packed' && method === 'cod';
        expect(next.includes('confirmed')).toBe(shouldOffer);
      }
    }
  });

  it('never offers `pending` or `awaiting_payment` — nothing before them is ever revertable', () => {
    for (const status of ALL_STATUSES) {
      for (const method of METHODS) {
        for (const statusBeforeExit of [...ALL_STATUSES, undefined, null]) {
          const next = allowedTransitions(order(status, method, statusBeforeExit));
          expect(next).not.toContain('pending');
          expect(next).not.toContain('awaiting_payment');
        }
      }
    }
  });

  it('only ever moves one step forward through the fulfilment chain', () => {
    expect(allowedTransitions(order('paid', 'card'))).toEqual(['packed', 'refunded']);
    expect(allowedTransitions(order('confirmed', 'cod'))).toEqual(['packed', 'cancelled']);
  });

  it('also offers one step back, everywhere but `paid`/`confirmed`/`pending`/`awaiting_payment`', () => {
    expect(allowedTransitions(order('packed', 'card'))).toEqual(['shipped', 'paid', 'refunded']);
    expect(allowedTransitions(order('packed', 'cod'))).toEqual(['shipped', 'confirmed', 'cancelled']);
    expect(allowedTransitions(order('shipped', 'cod'))).toEqual(['delivered', 'packed', 'cancelled']);
    expect(allowedTransitions(order('shipped', 'card'))).toEqual(['delivered', 'packed', 'refunded']);
    expect(allowedTransitions(order('delivered', 'card'))).toEqual(['shipped', 'refunded']);
    expect(allowedTransitions(order('delivered', 'cod'))).toEqual(['shipped', 'refunded']);
  });

  it('offers nothing from `cancelled`/`refunded` when no eligible `statusBeforeExit` is recorded', () => {
    for (const method of METHODS) {
      // Never recorded at all (e.g. an order cancelled outside the admin
      // panel, by `create.ts`/`confirmPayment.ts` on a payment failure).
      expect(allowedTransitions(order('cancelled', method))).toEqual([]);
      expect(allowedTransitions(order('refunded', method))).toEqual([]);
      // Recorded, but not `STOCK_COMMITTED` — nothing useful to go back to.
      expect(allowedTransitions(order('cancelled', method, 'pending'))).toEqual([]);
      expect(allowedTransitions(order('cancelled', method, 'awaiting_payment'))).toEqual([]);
    }
  });

  it('offers exactly the recorded `statusBeforeExit` — nothing else — when it is `STOCK_COMMITTED`', () => {
    for (const status of STOCK_COMMITTED_STATUSES) {
      expect(allowedTransitions(order('cancelled', 'card', status))).toEqual([status]);
      expect(allowedTransitions(order('refunded', 'card', status))).toEqual([status]);
      expect(allowedTransitions(order('cancelled', 'cod', status))).toEqual([status]);
      expect(allowedTransitions(order('refunded', 'cod', status))).toEqual([status]);
    }
  });

  it('offers refund once the money has been collected, and cancel before that', () => {
    // Card is taken up front…
    expect(allowedTransitions(order('awaiting_payment', 'card'))).toEqual(['cancelled']);
    expect(allowedTransitions(order('paid', 'card'))).toContain('refunded');
    expect(allowedTransitions(order('delivered', 'card'))).toContain('refunded');

    // …cash on delivery only when the carrier hands the parcel over, so an
    // order still in transit is cancelled: there is nothing to refund yet.
    expect(allowedTransitions(order('confirmed', 'cod'))).toContain('cancelled');
    expect(allowedTransitions(order('packed', 'cod'))).toContain('cancelled');
    expect(allowedTransitions(order('delivered', 'cod'))).toContain('refunded');
  });

  it('never offers both ways out at once', () => {
    for (const status of ALL_STATUSES) {
      for (const method of METHODS) {
        const next = allowedTransitions(order(status, method));
        expect(next.includes('cancelled') && next.includes('refunded')).toBe(false);
      }
    }
  });

  it('offers a way out of every non-terminal status', () => {
    // Otherwise an order could get stuck somewhere with no operator action left.
    for (const status of ALL_STATUSES) {
      if (status === 'cancelled' || status === 'refunded') continue;
      for (const method of METHODS) {
        expect(allowedTransitions(order(status, method)).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('canTransition', () => {
  it('agrees with allowedTransitions', () => {
    for (const status of ALL_STATUSES) {
      for (const method of METHODS) {
        for (const target of ALL_STATUSES) {
          expect(canTransition(order(status, method), target)).toBe(
            allowedTransitions(order(status, method)).includes(target),
          );
        }
      }
    }
  });

  it('rejects a jump past a step', () => {
    expect(canTransition(order('paid', 'card'), 'delivered')).toBe(false);
    expect(canTransition(order('confirmed', 'cod'), 'shipped')).toBe(false);
  });

  it('allows exactly one step backward, never further', () => {
    expect(canTransition(order('shipped', 'card'), 'packed')).toBe(true);
    expect(canTransition(order('delivered', 'cod'), 'shipped')).toBe(true);
    expect(canTransition(order('packed', 'card'), 'paid')).toBe(true);
    expect(canTransition(order('packed', 'cod'), 'confirmed')).toBe(true);
    // Two steps back in one jump.
    expect(canTransition(order('delivered', 'card'), 'packed')).toBe(false);
    expect(canTransition(order('shipped', 'card'), 'paid')).toBe(false);
  });

  it('never lets the wrong payment method revert `packed` onto the other method’s predecessor', () => {
    // A card order never held `confirmed`; a cash order never held `paid`.
    expect(canTransition(order('packed', 'card'), 'confirmed')).toBe(false);
    expect(canTransition(order('packed', 'cod'), 'paid')).toBe(false);
  });

  it('allows reverting `cancelled`/`refunded` only onto the exact recorded `statusBeforeExit`', () => {
    expect(canTransition(order('refunded', 'card', 'paid'), 'paid')).toBe(true);
    expect(canTransition(order('refunded', 'card', 'paid'), 'packed')).toBe(false);
    expect(canTransition(order('cancelled', 'cod', 'confirmed'), 'confirmed')).toBe(true);
    expect(canTransition(order('cancelled', 'cod', 'confirmed'), 'paid')).toBe(false);
  });
});

describe('revertTarget', () => {
  it('picks `paid` or `confirmed` for `packed`, by payment method', () => {
    expect(revertTarget(order('packed', 'card'))).toBe('paid');
    expect(revertTarget(order('packed', 'cod'))).toBe('confirmed');
  });

  it('goes back exactly one step from `shipped` and `delivered`, independent of payment method', () => {
    for (const method of METHODS) {
      expect(revertTarget(order('shipped', method))).toBe('packed');
      expect(revertTarget(order('delivered', method))).toBe('shipped');
    }
  });

  it('has no target for `packed`/`shipped`/`delivered`’s siblings', () => {
    for (const status of ALL_STATUSES) {
      if (['packed', 'shipped', 'delivered', 'cancelled', 'refunded'].includes(status)) continue;
      for (const method of METHODS) {
        expect(revertTarget(order(status, method))).toBeNull();
      }
    }
  });

  it('restores `statusBeforeExit` for `cancelled`/`refunded`, exactly when it is `STOCK_COMMITTED`', () => {
    for (const status of ALL_STATUSES) {
      const eligible = STOCK_COMMITTED_STATUSES.includes(status);
      for (const terminal of ['cancelled', 'refunded'] as const) {
        expect(revertTarget(order(terminal, 'card', status))).toBe(eligible ? status : null);
      }
    }
  });

  it('has no target for `cancelled`/`refunded` when nothing was recorded', () => {
    expect(revertTarget(order('cancelled', 'card'))).toBeNull();
    expect(revertTarget(order('refunded', 'card', null))).toBeNull();
  });
});

describe('revertCrossesPayment', () => {
  it('is true only for cash on delivery stepping back out of `delivered`', () => {
    expect(revertCrossesPayment(order('delivered', 'cod'))).toBe(true);
  });

  it('is false everywhere else, including reverting `packed` for either payment method', () => {
    // Card counts every status from `paid` on as collected, so stepping back
    // within that range never flips the answer. Cash on delivery only counts
    // `delivered` as collected in the first place, so `packed → confirmed`
    // was already "not collected" on both sides.
    expect(revertCrossesPayment(order('delivered', 'card'))).toBe(false);
    expect(revertCrossesPayment(order('shipped', 'card'))).toBe(false);
    expect(revertCrossesPayment(order('shipped', 'cod'))).toBe(false);
    expect(revertCrossesPayment(order('packed', 'card'))).toBe(false);
    expect(revertCrossesPayment(order('packed', 'cod'))).toBe(false);
  });

  it('is false reverting out of `cancelled`/`refunded`, for every recorded `statusBeforeExit`', () => {
    // The target is always the exact status that decided which exit was
    // offered in the first place, so it can never disagree with itself.
    for (const status of STOCK_COMMITTED_STATUSES) {
      for (const method of METHODS) {
        expect(revertCrossesPayment(order('cancelled', method, status))).toBe(false);
        expect(revertCrossesPayment(order('refunded', method, status))).toBe(false);
      }
    }
  });
});

describe('isStockCommitted', () => {
  it('is true exactly where stock has already been decremented', () => {
    // `create.ts` decrements for cash on delivery at `confirmed`;
    // `confirmPayment.ts` decrements for card at `paid`.
    expect(isStockCommitted('confirmed')).toBe(true);
    expect(isStockCommitted('paid')).toBe(true);
    expect(isStockCommitted('packed')).toBe(true);
    expect(isStockCommitted('shipped')).toBe(true);
    expect(isStockCommitted('delivered')).toBe(true);
  });

  it('is false while the order still holds a reservation instead', () => {
    // Nothing was taken out of stock, so cancelling must not put anything back —
    // it only drops the reservation.
    expect(isStockCommitted('pending')).toBe(false);
    expect(isStockCommitted('awaiting_payment')).toBe(false);
  });

  it('is false for the terminal statuses', () => {
    expect(isStockCommitted('cancelled')).toBe(false);
    expect(isStockCommitted('refunded')).toBe(false);
  });
});
