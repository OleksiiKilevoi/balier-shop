import { describe, expect, it } from 'vitest';
import { buildCartSummary, mergeCartItems, type CartVariantData } from './index';
import {
  decodeCartItems,
  MAX_CART_LINES,
  MAX_ITEM_QUANTITY,
  parseCartItems,
} from '../validation/cart';

/**
 * The roadmap names order-total calculation as one of the two places in Phase 3
 * where a bug costs money, so it is tested rather than eyeballed. Every case
 * below is a way the client's idea of the cart can differ from the database's.
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

describe('buildCartSummary', () => {
  it('prices lines from the database, never from the request', () => {
    const summary = buildCartSummary(
      [{ variantId: id(1), quantity: 2 }],
      [variant({ variantId: id(1), unitPrice: 195000 })],
    );

    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0]?.lineTotal).toBe(390000);
    expect(summary.itemsTotal).toBe(390000);
    expect(summary.itemCount).toBe(2);
  });

  it('charges for goods only — delivery is the carrier tariff, paid by the recipient', () => {
    const summary = buildCartSummary(
      [{ variantId: id(1), quantity: 1 }],
      [variant({ variantId: id(1), unitPrice: 480000 })],
    );

    expect(summary.deliveryTotal).toBe(0);
    expect(summary.total).toBe(summary.itemsTotal);
  });

  it('clamps a quantity to what is available and says so', () => {
    const summary = buildCartSummary(
      [{ variantId: id(1), quantity: 9 }],
      [variant({ variantId: id(1), available: 2, unitPrice: 100000 })],
    );

    expect(summary.lines[0]?.quantity).toBe(2);
    expect(summary.itemsTotal).toBe(200000);
    expect(summary.notices).toEqual([
      { variantId: id(1), reason: 'reduced', title: 'Сумка', quantity: 2 },
    ]);
  });

  it('drops a variant the query did not return', () => {
    const summary = buildCartSummary([{ variantId: id(9), quantity: 1 }], []);

    expect(summary.lines).toHaveLength(0);
    expect(summary.total).toBe(0);
    expect(summary.notices[0]).toMatchObject({ reason: 'unavailable', title: null });
  });

  it('drops a variant that exists but has nothing available', () => {
    const summary = buildCartSummary(
      [{ variantId: id(1), quantity: 1 }],
      [variant({ variantId: id(1), available: 0 })],
    );

    expect(summary.lines).toHaveLength(0);
    expect(summary.notices[0]).toMatchObject({ reason: 'out_of_stock', title: 'Сумка' });
  });

  it('treats a reservation that ate the whole stock as out of stock, not negative', () => {
    // `available` is `stock − reservations` and can go negative if stock was
    // lowered after an order reserved against it.
    const summary = buildCartSummary(
      [{ variantId: id(1), quantity: 1 }],
      [variant({ variantId: id(1), available: -3 })],
    );

    expect(summary.lines).toHaveLength(0);
    expect(summary.itemsTotal).toBe(0);
  });

  it('keeps the requested order so the page does not reshuffle on revalidation', () => {
    const summary = buildCartSummary(
      [
        { variantId: id(3), quantity: 1 },
        { variantId: id(1), quantity: 1 },
        { variantId: id(2), quantity: 1 },
      ],
      [
        variant({ variantId: id(1) }),
        variant({ variantId: id(2) }),
        variant({ variantId: id(3) }),
      ],
    );

    expect(summary.lines.map((line) => line.variantId)).toEqual([id(3), id(1), id(2)]);
  });

  it('adds several lines up', () => {
    const summary = buildCartSummary(
      [
        { variantId: id(1), quantity: 2 },
        { variantId: id(2), quantity: 1 },
      ],
      [
        variant({ variantId: id(1), unitPrice: 550000 }),
        variant({ variantId: id(2), unitPrice: 195000 }),
      ],
    );

    expect(summary.itemsTotal).toBe(1295000);
    expect(summary.itemCount).toBe(3);
    expect(summary.notices).toHaveLength(0);
  });

  it('returns an empty cart for no items', () => {
    const summary = buildCartSummary([], []);

    expect(summary).toEqual({
      lines: [],
      notices: [],
      itemsTotal: 0,
      deliveryTotal: 0,
      total: 0,
      itemCount: 0,
    });
  });
});

describe('mergeCartItems', () => {
  it('sums repeated variant ids into one line', () => {
    expect(
      mergeCartItems([
        { variantId: id(1), quantity: 2 },
        { variantId: id(2), quantity: 1 },
        { variantId: id(1), quantity: 3 },
      ]),
    ).toEqual([
      { variantId: id(1), quantity: 5 },
      { variantId: id(2), quantity: 1 },
    ]);
  });

  it('caps a merged quantity at the per-line limit', () => {
    const merged = mergeCartItems([
      { variantId: id(1), quantity: MAX_ITEM_QUANTITY },
      { variantId: id(1), quantity: MAX_ITEM_QUANTITY },
    ]);

    expect(merged[0]?.quantity).toBe(MAX_ITEM_QUANTITY);
  });

  it('caps the number of lines', () => {
    const items = Array.from({ length: MAX_CART_LINES + 5 }, (_, index) => ({
      variantId: id(index),
      quantity: 1,
    }));

    expect(mergeCartItems(items)).toHaveLength(MAX_CART_LINES);
  });
});

describe('parseCartItems', () => {
  it('accepts a well-formed cart', () => {
    expect(parseCartItems([{ variantId: id(1), quantity: 2 }])).toEqual([
      { variantId: id(1), quantity: 2 },
    ]);
  });

  it.each([
    ['not an array', { variantId: id(1), quantity: 1 }],
    ['a non-uuid variant', [{ variantId: 'sumka', quantity: 1 }]],
    ['a zero quantity', [{ variantId: id(1), quantity: 0 }]],
    ['a negative quantity', [{ variantId: id(1), quantity: -5 }]],
    ['a fractional quantity', [{ variantId: id(1), quantity: 1.5 }]],
    ['a quantity past the limit', [{ variantId: id(1), quantity: MAX_ITEM_QUANTITY + 1 }]],
    ['a price smuggled in place of a quantity', [{ variantId: id(1), quantity: '1' }]],
  ])('degrades %s to an empty cart', (_label, value) => {
    expect(parseCartItems(value)).toEqual([]);
  });
});

describe('decodeCartItems', () => {
  it('reads back what the store wrote', () => {
    const items = [{ variantId: id(1), quantity: 3 }];
    expect(decodeCartItems(JSON.stringify(items))).toEqual(items);
  });

  it('degrades unparseable storage to an empty cart instead of throwing', () => {
    expect(decodeCartItems('{oops')).toEqual([]);
    expect(decodeCartItems('')).toEqual([]);
  });
});
