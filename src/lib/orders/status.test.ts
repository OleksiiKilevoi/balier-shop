import { describe, expect, it } from 'vitest';
import { orderStatus } from '~/lib/db/schema';
import type { OrderStatus, PaymentMethod } from '~/lib/db/schema';
import { allowedTransitions, canTransition, isStockCommitted } from './status';

/**
 * The admin panel's half of the order state machine. Worth testing on its own
 * because two of its rules are invisible at the call site and expensive to get
 * wrong: which target statuses the panel may never produce (`paid` — the webhook
 * is its only writer), and when undoing an order has to put stock back.
 */

const ALL_STATUSES = orderStatus.enumValues;
const METHODS: PaymentMethod[] = ['card', 'cod'];

function order(status: OrderStatus, paymentMethod: PaymentMethod) {
  return { status, paymentMethod };
}

describe('allowedTransitions', () => {
  it('never offers `paid` from any state, either payment method', () => {
    // `docs/CONVENTIONS.md`: an order becomes paid only in the webhook handler.
    // A button that produces it is a button that forges a payment.
    for (const status of ALL_STATUSES) {
      for (const method of METHODS) {
        expect(allowedTransitions(order(status, method))).not.toContain('paid');
      }
    }
  });

  it('never offers a status that belongs to order creation', () => {
    for (const status of ALL_STATUSES) {
      for (const method of METHODS) {
        const next = allowedTransitions(order(status, method));
        expect(next).not.toContain('pending');
        expect(next).not.toContain('awaiting_payment');
        expect(next).not.toContain('confirmed');
      }
    }
  });

  it('only ever moves one step forward through the fulfilment chain', () => {
    expect(allowedTransitions(order('paid', 'card'))).toEqual(['packed', 'refunded']);
    expect(allowedTransitions(order('confirmed', 'cod'))).toEqual(['packed', 'cancelled']);
    expect(allowedTransitions(order('packed', 'card'))).toEqual(['shipped', 'refunded']);
    expect(allowedTransitions(order('shipped', 'cod'))).toEqual(['delivered', 'cancelled']);
  });

  it('offers nothing at all from a terminal status', () => {
    for (const method of METHODS) {
      expect(allowedTransitions(order('cancelled', method))).toEqual([]);
      expect(allowedTransitions(order('refunded', method))).toEqual([]);
    }
  });

  it('offers refund once the money has been collected, and cancel before that', () => {
    // Card is taken up front…
    expect(allowedTransitions(order('awaiting_payment', 'card'))).toEqual(['cancelled']);
    expect(allowedTransitions(order('paid', 'card'))).toContain('refunded');
    expect(allowedTransitions(order('delivered', 'card'))).toEqual(['refunded']);

    // …cash on delivery only when the carrier hands the parcel over, so an
    // order still in transit is cancelled: there is nothing to refund yet.
    expect(allowedTransitions(order('confirmed', 'cod'))).toContain('cancelled');
    expect(allowedTransitions(order('packed', 'cod'))).toEqual(['shipped', 'cancelled']);
    expect(allowedTransitions(order('delivered', 'cod'))).toEqual(['refunded']);
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

  it('rejects a move backwards', () => {
    expect(canTransition(order('shipped', 'card'), 'packed')).toBe(false);
    expect(canTransition(order('delivered', 'cod'), 'shipped')).toBe(false);
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
