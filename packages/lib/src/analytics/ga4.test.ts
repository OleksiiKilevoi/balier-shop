import { describe, expect, it } from 'vitest';
import { cartLineItem, checkoutParams, ga4Item, orderLineItem, purchaseParams } from './ga4';

describe('ga4Item', () => {
  it('prices the item in hryvnias with kopiykas kept as decimals', () => {
    expect(
      ga4Item({ sku: 'RIUKZAK-BLACK', title: 'Рюкзак', variantName: 'Чорний', categoryTitle: 'Рюкзаки', unitPrice: 999_950, quantity: 2 }),
    ).toEqual({
      item_id: 'RIUKZAK-BLACK',
      item_name: 'Рюкзак',
      item_variant: 'Чорний',
      item_category: 'Рюкзаки',
      price: 9999.5,
      quantity: 2,
    });
  });

  it('leaves out the variant and category when there are none', () => {
    expect(ga4Item({ sku: 'X', title: 'X', variantName: null, categoryTitle: null, unitPrice: 100, quantity: 1 })).toEqual({
      item_id: 'X',
      item_name: 'X',
      price: 1,
      quantity: 1,
    });
  });
});

describe('cartLineItem', () => {
  it('charges the bundle price the cart will actually pay', () => {
    const item = cartLineItem({
      sku: 'HAMANETS-KONVERT',
      productTitle: 'Гаманець-конверт',
      variantName: null,
      unitPrice: 195_000,
      bundleUnitPrice: 175_500,
      quantity: 1,
    });
    expect(item.price).toBe(1755);
    expect(item.item_id).toBe('HAMANETS-KONVERT');
  });
});

describe('orderLineItem', () => {
  it('maps a stored order line', () => {
    expect(
      orderLineItem({ sku: 'SHOPER-BROWN', productTitle: 'Шопер', variantName: 'Коричневий', unitPrice: 540_000, quantity: 1 }),
    ).toEqual({ item_id: 'SHOPER-BROWN', item_name: 'Шопер', item_variant: 'Коричневий', price: 5400, quantity: 1 });
  });
});

describe('purchaseParams', () => {
  const lines = [{ sku: 'A', productTitle: 'A', variantName: null, unitPrice: 100_000, quantity: 2 }];

  it('carries the order number as the transaction id and the total in hryvnias', () => {
    expect(purchaseParams({ orderNumber: 'B-1042', total: 180_000, promoCode: 'WELCOME10', items: lines })).toEqual({
      transaction_id: 'B-1042',
      value: 1800,
      currency: 'UAH',
      coupon: 'WELCOME10',
      items: [{ item_id: 'A', item_name: 'A', price: 1000, quantity: 2 }],
    });
  });

  it('has no coupon field when no code was used', () => {
    expect(purchaseParams({ orderNumber: 'B-1', total: 200_000, promoCode: null, items: lines })).not.toHaveProperty('coupon');
  });
});

describe('checkoutParams', () => {
  it('values the checkout at the items total', () => {
    const params = checkoutParams({
      itemsTotal: 351_000,
      lines: [
        { sku: 'A', productTitle: 'A', variantName: null, unitPrice: 195_000, bundleUnitPrice: 175_500, quantity: 2 },
      ],
    });
    expect(params).toEqual({
      value: 3510,
      currency: 'UAH',
      items: [{ item_id: 'A', item_name: 'A', price: 1755, quantity: 2 }],
    });
  });
});
