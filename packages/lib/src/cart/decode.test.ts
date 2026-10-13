import { describe, expect, it } from 'vitest';
import { readCartItems } from './decode';
import { parseCartItems } from '../validation/cart';

const id = '005c4c59-12d4-468c-b838-d984c6f7c344';
const cases: [string, unknown][] = [
  ['a valid cart', [{ variantId: id, quantity: 2 }]],
  ['an empty cart', []],
  ['extra fields, stripped', [{ variantId: id, quantity: 1, price: 1 }]],
  ['zero quantity', [{ variantId: id, quantity: 0 }]],
  ['fractional quantity', [{ variantId: id, quantity: 1.5 }]],
  ['quantity at the limit', [{ variantId: id, quantity: 99 }]],
  ['quantity past the limit', [{ variantId: id, quantity: 100 }]],
  ['quantity as a string', [{ variantId: id, quantity: '2' }]],
  ['not a uuid', [{ variantId: 'abc', quantity: 1 }]],
  ['uuid with a bad version', [{ variantId: '005c4c59-12d4-068c-b838-d984c6f7c344', quantity: 1 }]],
  ['upper-case uuid', [{ variantId: id.toUpperCase(), quantity: 1 }]],
  ['one bad line among good ones', [{ variantId: id, quantity: 1 }, { variantId: id, quantity: -1 }]],
  ['30 lines', Array.from({ length: 30 }, () => ({ variantId: id, quantity: 1 }))],
  ['31 lines', Array.from({ length: 31 }, () => ({ variantId: id, quantity: 1 }))],
  ['an object', { variantId: id, quantity: 1 }],
  ['null', null],
  ['a null line', [null]],
  ['a string', 'cart'],
];

describe('readCartItems', () => {
  it.each(cases)('agrees with cartItemsSchema on %s', (_label, value) => {
    expect(readCartItems(value)).toEqual(parseCartItems(value));
  });
});
