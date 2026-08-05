import { describe, expect, it } from 'vitest';
import { MAX_CART_LINES, MAX_ITEM_QUANTITY } from '~/lib/validation/cart';
import {
  DRAFT_ACTIONS,
  DRAFT_FIELDS,
  addDraftItem,
  applyDraftAction,
  isCreateSubmit,
  isSearchQuery,
  pickSettlement,
  readDraft,
  removeDraftItem,
} from './draft';
import type { OrderDraft } from './draft';

/**
 * The draft is read straight out of an untrusted form body on every submit, so
 * these cover two things: that a normal body round-trips, and that a hostile or
 * simply stale one still produces a renderable draft instead of throwing. The
 * page has no other line of defence — a throw here is a 500 in front of a
 * manager mid-order.
 */

const VARIANT_A = '11111111-1111-4111-8111-111111111111';
const VARIANT_B = '22222222-2222-4222-8222-222222222222';

function body(entries: [string, string][]): FormData {
  const form = new FormData();
  for (const [key, value] of entries) form.append(key, value);
  return form;
}

function line(variantId: string, quantity: number): [string, string][] {
  return [
    [DRAFT_FIELDS.item, variantId],
    [`${DRAFT_FIELDS.quantityPrefix}${variantId}`, String(quantity)],
  ];
}

const EMPTY: OrderDraft = readDraft(new FormData());

describe('readDraft', () => {
  it('reads an empty body as an empty draft with the defaults', () => {
    expect(EMPTY).toEqual({
      customerName: '',
      customerPhoneDigits: '',
      customerEmail: '',
      comment: '',
      paymentMethod: 'cod',
      deliveryMethod: 'np_warehouse',
      settlementRef: null,
      warehouseRef: null,
      address: '',
      items: [],
      productQuery: '',
      settlementQuery: '',
      warehouseQuery: '',
    });
  });

  it('round-trips a filled draft', () => {
    const draft = readDraft(
      body([
        [DRAFT_FIELDS.name, '  Олена Ковальчук '],
        [DRAFT_FIELDS.phone, '050 123 45 67'],
        [DRAFT_FIELDS.email, 'olena@example.com'],
        [DRAFT_FIELDS.comment, 'Подарунок, без чека'],
        [DRAFT_FIELDS.paymentMethod, 'card'],
        [DRAFT_FIELDS.deliveryMethod, 'np_postomat'],
        [DRAFT_FIELDS.settlement, 'city-ref'],
        [DRAFT_FIELDS.warehouse, 'wh-ref'],
        [DRAFT_FIELDS.productQuery, 'сумка'],
        ...line(VARIANT_A, 2),
        ...line(VARIANT_B, 1),
      ]),
    );

    expect(draft.customerName).toBe('Олена Ковальчук');
    // The phone is the exception: it is reduced to the nine local digits the
    // masked field carries, however it was typed. The `+380` is put back by
    // the page, for `customerPhoneSchema`, and only when the order is created.
    expect(draft.customerPhoneDigits).toBe('501234567');
    expect(draft.paymentMethod).toBe('card');
    expect(draft.deliveryMethod).toBe('np_postomat');
    expect(draft.settlementRef).toBe('city-ref');
    expect(draft.warehouseRef).toBe('wh-ref');
    expect(draft.productQuery).toBe('сумка');
    expect(draft.items).toEqual([
      { variantId: VARIANT_A, quantity: 2 },
      { variantId: VARIANT_B, quantity: 1 },
    ]);
  });

  it('reduces any way of writing the phone to its nine local digits', () => {
    // The mask is script; a body can arrive from a scriptless submit, from a
    // paste the mask has not seen yet, or hand-forged.
    const digits = (raw: string) => readDraft(body([[DRAFT_FIELDS.phone, raw]])).customerPhoneDigits;

    expect(digits('50 123 45 67')).toBe('501234567');
    expect(digits('0501234567')).toBe('501234567');
    expect(digits('+38 (050) 123-45-67')).toBe('501234567');
    expect(digits('380501234567')).toBe('501234567');
    // Half-typed and junk both stay renderable; `customerPhoneSchema` is what
    // refuses them, at create time.
    expect(digits('50 123')).toBe('50123');
    expect(digits('телефон')).toBe('');
  });

  it('keeps the branch and the address whichever delivery method is chosen', () => {
    // Switching to «кур'єр» to check something and back must not silently drop
    // the branch that was already picked — see the comment in `readDraft`.
    const draft = readDraft(
      body([
        [DRAFT_FIELDS.deliveryMethod, 'np_courier'],
        [DRAFT_FIELDS.warehouse, 'wh-ref'],
        [DRAFT_FIELDS.address, 'вул. Хрещатик, 1'],
      ]),
    );

    expect(draft.warehouseRef).toBe('wh-ref');
    expect(draft.address).toBe('вул. Хрещатик, 1');
  });

  it('falls back to the defaults for an unknown payment or delivery method', () => {
    const draft = readDraft(
      body([
        [DRAFT_FIELDS.paymentMethod, 'bitcoin'],
        [DRAFT_FIELDS.deliveryMethod, 'owl'],
      ]),
    );

    expect(draft.paymentMethod).toBe('cod');
    expect(draft.deliveryMethod).toBe('np_warehouse');
  });

  it('reads a missing or unparseable quantity as 1 rather than dropping the line', () => {
    const draft = readDraft(
      body([
        [DRAFT_FIELDS.item, VARIANT_A],
        [DRAFT_FIELDS.item, VARIANT_B],
        [`${DRAFT_FIELDS.quantityPrefix}${VARIANT_B}`, 'три'],
      ]),
    );

    expect(draft.items).toEqual([
      { variantId: VARIANT_A, quantity: 1 },
      { variantId: VARIANT_B, quantity: 1 },
    ]);
  });

  it('clamps a quantity to the cart limits', () => {
    const draft = readDraft(
      body([...line(VARIANT_A, 0), ...line(VARIANT_B, MAX_ITEM_QUANTITY + 50)]),
    );

    expect(draft.items).toEqual([
      { variantId: VARIANT_A, quantity: 1 },
      { variantId: VARIANT_B, quantity: MAX_ITEM_QUANTITY },
    ]);
  });

  it('folds a repeated variant id into one line', () => {
    const draft = readDraft(body([...line(VARIANT_A, 2), [DRAFT_FIELDS.item, VARIANT_A]]));
    expect(draft.items).toEqual([{ variantId: VARIANT_A, quantity: 2 }]);
  });

  it('stops reading lines at the cart ceiling', () => {
    const entries: [string, string][] = [];
    for (let i = 0; i < MAX_CART_LINES + 10; i++) {
      entries.push([DRAFT_FIELDS.item, `variant-${i}`]);
    }

    expect(readDraft(body(entries)).items).toHaveLength(MAX_CART_LINES);
  });
});

describe('applyDraftAction', () => {
  it('leaves the draft alone for a plain search submit', () => {
    const draft = addDraftItem(EMPTY, VARIANT_A);
    expect(applyDraftAction(draft, body([[DRAFT_FIELDS.productQuery, 'сумка']]))).toBe(draft);
  });

  it('adds a variant, then bumps it instead of repeating the line', () => {
    const once = applyDraftAction(EMPTY, body([[DRAFT_ACTIONS.add, VARIANT_A]]));
    const twice = applyDraftAction(once, body([[DRAFT_ACTIONS.add, VARIANT_A]]));

    expect(once.items).toEqual([{ variantId: VARIANT_A, quantity: 1 }]);
    expect(twice.items).toEqual([{ variantId: VARIANT_A, quantity: 2 }]);
  });

  it('removes a line', () => {
    const draft = addDraftItem(addDraftItem(EMPTY, VARIANT_A), VARIANT_B);
    const after = applyDraftAction(draft, body([[DRAFT_ACTIONS.remove, VARIANT_A]]));

    expect(after.items).toEqual([{ variantId: VARIANT_B, quantity: 1 }]);
  });

  it('picking a settlement clears the branch chosen in the previous one', () => {
    const draft: OrderDraft = {
      ...EMPTY,
      settlementRef: 'kyiv',
      settlementQuery: 'льв',
      warehouseRef: 'kyiv-25',
      warehouseQuery: '25',
    };

    const after = applyDraftAction(draft, body([[DRAFT_ACTIONS.pickSettlement, 'lviv']]));

    expect(after.settlementRef).toBe('lviv');
    expect(after.warehouseRef).toBeNull();
    expect(after.warehouseQuery).toBe('');
    // The box now shows the chosen city instead of what was typed to find it,
    // which is also what closes the dropdown on the next render.
    expect(after.settlementQuery).toBe('');
  });

  it('re-picking the same settlement keeps the branch', () => {
    // Otherwise a mis-click on the city currently shown would quietly undo the
    // branch below it.
    const draft: OrderDraft = {
      ...EMPTY,
      settlementRef: 'kyiv',
      settlementQuery: 'киї',
      warehouseRef: 'kyiv-25',
    };
    const after = pickSettlement(draft, 'kyiv');

    expect(after.warehouseRef).toBe('kyiv-25');
    expect(after.settlementQuery).toBe('');
  });

  it('picking a branch closes its own dropdown', () => {
    const draft: OrderDraft = { ...EMPTY, settlementRef: 'kyiv', warehouseQuery: '25' };
    const after = applyDraftAction(draft, body([[DRAFT_ACTIONS.pickWarehouse, 'kyiv-25']]));

    expect(after.warehouseRef).toBe('kyiv-25');
    expect(after.warehouseQuery).toBe('');
  });

  it('ignores an action whose value is blank', () => {
    const draft = addDraftItem(EMPTY, VARIANT_A);
    expect(applyDraftAction(draft, body([[DRAFT_ACTIONS.add, '   ']]))).toBe(draft);
  });
});

describe('the basket limits', () => {
  it('refuses to grow past the cart line ceiling', () => {
    let draft = EMPTY;
    for (let i = 0; i < MAX_CART_LINES + 5; i++) draft = addDraftItem(draft, `variant-${i}`);

    expect(draft.items).toHaveLength(MAX_CART_LINES);
  });

  it('stops bumping a line at the per-line ceiling', () => {
    let draft = EMPTY;
    for (let i = 0; i < MAX_ITEM_QUANTITY + 5; i++) draft = addDraftItem(draft, VARIANT_A);

    expect(draft.items).toEqual([{ variantId: VARIANT_A, quantity: MAX_ITEM_QUANTITY }]);
  });

  it('removing an id that is not in the basket changes nothing', () => {
    const draft = addDraftItem(EMPTY, VARIANT_A);
    expect(removeDraftItem(draft, VARIANT_B).items).toEqual(draft.items);
  });
});

describe('isSearchQuery', () => {
  it('an empty box is never a search', () => {
    expect(isSearchQuery('', null)).toBe(false);
    expect(isSearchQuery('', 'Київ, м. Київ')).toBe(false);
  });

  it('a box holding exactly the picked label is still the picked row', () => {
    // The field is submitted back untouched on every click on the page — if
    // that read as a search, picking a city and then pressing «Створити» would
    // un-pick it.
    expect(isSearchQuery('Київ, м. Київ', 'Київ, м. Київ')).toBe(false);
  });

  it('typing over the picked label is a search', () => {
    expect(isSearchQuery('Львів', 'Київ, м. Київ')).toBe(true);
    expect(isSearchQuery('Київ, м. Ки', 'Київ, м. Київ')).toBe(true);
  });

  it('anything typed with nothing picked is a search', () => {
    expect(isSearchQuery('льв', null)).toBe(true);
  });
});

describe('isCreateSubmit', () => {
  it('is true only for the create button', () => {
    expect(isCreateSubmit(body([[DRAFT_ACTIONS.create, '1']]))).toBe(true);
    expect(isCreateSubmit(body([[DRAFT_ACTIONS.add, VARIANT_A]]))).toBe(false);
    expect(isCreateSubmit(new FormData())).toBe(false);
  });
});
