import { describe, expect, it } from 'vitest';
import { orderStatus } from '../db/schema';
import type { OrderStatus, PaymentMethod } from '../db/schema';
import {
  allowedTransitions,
  canTransition,
  carrierCanAdvance,
  isStockCommitted,
  orderDetailsLock,
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
  it('offers the panel nothing but the exit from every non-terminal status — the forward chain is carrier-driven', () => {
    // `docs/plans/novaposhta.md`, NP-4: `paid` is the webhook's, `confirmed`
    // is order creation's, `packed` is the waybill's, `shipped`/`delivered`
    // are tracking's. The panel keeps only the way out — asserted as a
    // property over every status and method, so no forward button can quietly
    // come back.
    for (const status of ALL_STATUSES) {
      if (status === 'cancelled' || status === 'refunded') continue;
      for (const method of METHODS) {
        const next = allowedTransitions(order(status, method));
        expect(next).toHaveLength(1);
        expect(next[0] === 'cancelled' || next[0] === 'refunded').toBe(true);
      }
    }
  });

  it('never offers `paid` or `confirmed` outside a terminal revert', () => {
    // `docs/CONVENTIONS.md`: an order becomes paid only in the webhook handler.
    // The one legal appearance left is restoring a recorded `statusBeforeExit`
    // out of `cancelled`/`refunded` — a status the order demonstrably held.
    for (const status of ALL_STATUSES) {
      if (status === 'cancelled' || status === 'refunded') continue;
      for (const method of METHODS) {
        const next = allowedTransitions(order(status, method));
        expect(next).not.toContain('paid');
        expect(next).not.toContain('confirmed');
      }
    }
    expect(allowedTransitions(order('refunded', 'card', 'paid'))).toEqual(['paid']);
    expect(allowedTransitions(order('cancelled', 'cod', 'confirmed'))).toEqual(['confirmed']);
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

  it('refuses every forward-chain move — forward and backward alike', () => {
    // Forward is the carrier's (`carrierCanAdvance`); backward out of `packed`
    // is deleting the waybill; and un-marking `shipped`/`delivered` by hand
    // would only be re-applied by the next tracking tick.
    expect(canTransition(order('paid', 'card'), 'packed')).toBe(false);
    expect(canTransition(order('confirmed', 'cod'), 'packed')).toBe(false);
    expect(canTransition(order('packed', 'card'), 'shipped')).toBe(false);
    expect(canTransition(order('shipped', 'card'), 'delivered')).toBe(false);
    expect(canTransition(order('shipped', 'card'), 'packed')).toBe(false);
    expect(canTransition(order('delivered', 'cod'), 'shipped')).toBe(false);
    expect(canTransition(order('packed', 'card'), 'paid')).toBe(false);
    expect(canTransition(order('packed', 'cod'), 'confirmed')).toBe(false);
  });

  it('allows reverting `cancelled`/`refunded` only onto the exact recorded `statusBeforeExit`', () => {
    expect(canTransition(order('refunded', 'card', 'paid'), 'paid')).toBe(true);
    expect(canTransition(order('refunded', 'card', 'paid'), 'packed')).toBe(false);
    expect(canTransition(order('cancelled', 'cod', 'confirmed'), 'confirmed')).toBe(true);
    expect(canTransition(order('cancelled', 'cod', 'confirmed'), 'paid')).toBe(false);
  });
});

describe('carrierCanAdvance', () => {
  it('moves strictly forward along packed → shipped → delivered, skipping allowed', () => {
    expect(carrierCanAdvance('packed', 'shipped')).toBe(true);
    expect(carrierCanAdvance('shipped', 'delivered')).toBe(true);
    // A 15-minute tick can miss the branch-arrival code and first see «отримано».
    expect(carrierCanAdvance('packed', 'delivered')).toBe(true);
  });

  it('never moves backward or in place', () => {
    expect(carrierCanAdvance('shipped', 'shipped')).toBe(false);
    expect(carrierCanAdvance('delivered', 'shipped')).toBe(false);
    expect(carrierCanAdvance('delivered', 'delivered')).toBe(false);
  });

  it('touches nothing outside the carrier chain — not `paid`, not the terminal statuses', () => {
    // Hard rule 2 (`paid` is webhook-only) and the NP-4 decision that
    // `cancelled`/`refunded` stay human-only, asserted over every status.
    for (const status of ALL_STATUSES) {
      if (status === 'packed' || status === 'shipped') continue;
      expect(carrierCanAdvance(status, 'shipped'), status).toBe(false);
      expect(carrierCanAdvance(status, 'delivered'), status).toBe(false);
    }
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

describe('orderDetailsLock', () => {
  const EDITABLE: OrderStatus[] = ['pending', 'awaiting_payment', 'paid', 'confirmed', 'packed'];

  it('allows editing exactly up to `packed`, while no waybill exists', () => {
    for (const status of ALL_STATUSES) {
      expect(orderDetailsLock({ status, npTtn: null }), status).toBe(
        EDITABLE.includes(status) ? null : 'edit_locked',
      );
    }
  });

  it('lets the waybill outrank every status — even an editable one', () => {
    // A ТТН is a carrier document carrying the recipient's name, phone and
    // destination; the fix it names (delete, edit, recreate) only exists while
    // the parcel has not moved, but the *reason* shown must be the waybill.
    for (const status of ALL_STATUSES) {
      expect(orderDetailsLock({ status, npTtn: '20450000000000' }), status).toBe('edit_ttn_exists');
    }
  });
});
