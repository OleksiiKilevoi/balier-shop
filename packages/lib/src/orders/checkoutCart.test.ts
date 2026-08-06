import { describe, expect, it } from 'vitest';
import { resolveCheckoutCart } from './checkoutCart';
import type { CartVariantData } from '../cart';

/**
 * Order-total calculation is one of the two places `docs/CONVENTIONS.md` names
 * as "a bug costs money" — this is the checkout half of it, and the one place
 * that differs from `~/lib/cart`: nothing here clamps. Any line that isn't
 * exactly satisfiable fails the whole checkout.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function variant(overrides: Partial<CartVariantData> & { variantId: string }): CartVariantData {
  return {
    productSlug: 'sumka',
    productTitle: 'Сумка',
    variantName: null,
    variantHex: null,
    sku: 'SKU-1',
    unitPrice: 550000,
    available: 10,
    imageUrl: null,
    imageAlt: null,
    ...overrides,
  };
}

describe('resolveCheckoutCart', () => {
  it('prices from the database and totals every line', () => {
    const result = resolveCheckoutCart(
      [
        { variantId: id(1), quantity: 2 },
        { variantId: id(2), quantity: 1 },
      ],
      [
        variant({ variantId: id(1), unitPrice: 550000 }),
        variant({ variantId: id(2), unitPrice: 195000 }),
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.itemsTotal).toBe(1295000);
    expect(result.lines.map((line) => line.lineTotal)).toEqual([1100000, 195000]);
  });

  it('refuses the whole order when one line needs clamping — checkout never silently shrinks a cart', () => {
    const result = resolveCheckoutCart(
      [
        { variantId: id(1), quantity: 1 },
        { variantId: id(2), quantity: 9 },
      ],
      [
        variant({ variantId: id(1) }),
        variant({ variantId: id(2), available: 2 }),
      ],
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.notices).toEqual([{ variantId: id(2), reason: 'reduced', title: 'Сумка' }]);
  });

  it('reports a variant the query did not return as unavailable', () => {
    const result = resolveCheckoutCart([{ variantId: id(9), quantity: 1 }], []);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.notices).toEqual([{ variantId: id(9), reason: 'unavailable', title: null }]);
  });

  it('reports a variant with nothing available as out of stock', () => {
    const result = resolveCheckoutCart(
      [{ variantId: id(1), quantity: 1 }],
      [variant({ variantId: id(1), available: 0 })],
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.notices).toEqual([{ variantId: id(1), reason: 'out_of_stock', title: 'Сумка' }]);
  });

  it('treats a reservation that ate the whole stock as out of stock, not negative', () => {
    const result = resolveCheckoutCart(
      [{ variantId: id(1), quantity: 1 }],
      [variant({ variantId: id(1), available: -3 })],
    );

    expect(result.ok).toBe(false);
  });

  it('collects every failing line, not just the first', () => {
    const result = resolveCheckoutCart(
      [
        { variantId: id(1), quantity: 1 },
        { variantId: id(2), quantity: 1 },
      ],
      [variant({ variantId: id(1), available: 0 })],
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.notices).toHaveLength(2);
  });
});
