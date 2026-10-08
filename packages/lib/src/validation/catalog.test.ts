import { describe, expect, it } from 'vitest';
import {
  PRODUCT_PRICE_MAX_HRYVNIAS,
  catalogFieldErrors,
  categoryActionSchema,
  newProductSchema,
  productActionSchema,
  productSlugSchema,
  skuSchema,
} from './catalog';

/**
 * The catalog forms are the first thing in the product that can write a price,
 * an availability flag or a public URL, so what these schemas let through is
 * what the shop shows and charges.
 *
 * Two properties are worth more than the rest and get exact assertions rather
 * than round trips: **a price crosses into kopiykas here and nowhere else**, so
 * the numbers below are written out in full; and **an empty optional price is
 * `null`, never `0`** — `price_override` is a nullable column whose NULL means
 * "not set", while zero would mean a free product.
 */

const BASE = {
  intent: 'product_save',
  title: 'Сумка «Люнет»',
  slug: 'sumka-liunet',
  description: '',
  details: '',
  dimensions: '',
  metaTitle: '',
  metaDescription: '',
  basePrice: '1850',
  categoryId: '',
  parcelSize: 'small',
  status: 'active',
  position: '0',
  companionDiscountPercent: '0',
} as const;

function saveProduct(overrides: Record<string, string> = {}) {
  return productActionSchema.safeParse({ ...BASE, ...overrides });
}

const VARIANT = {
  intent: 'variant_add',
  sku: 'SUMKA-LIUNET',
  colorName: '',
  colorHex: '',
  size: '',
  dimensions: '',
  priceOverride: '',
  inStock: 'on',
  position: '0',
} as const;

function addVariant(overrides: Record<string, string> = {}) {
  return productActionSchema.safeParse({ ...VARIANT, ...overrides });
}

describe('productSlugSchema', () => {
  it('accepts lowercase latin words joined by single hyphens', () => {
    for (const raw of ['lunet', 'sumka-liunet', 'kros-bodi-mini-2']) {
      expect(productSlugSchema.safeParse(raw).success, raw).toBe(true);
    }
  });

  it('lowercases and trims rather than refusing', () => {
    expect(productSlugSchema.parse('  Sumka-Liunet  ')).toBe('sumka-liunet');
  });

  it('refuses anything that would not survive a URL', () => {
    for (const raw of ['', ' ', 'сумка', 'sumka liunet', 'sumka--liunet', '-sumka', 'sumka-', 'su/mka', 'a'.repeat(61)]) {
      expect(productSlugSchema.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
    }
  });

  it('reports the failure as an error key, not a sentence', () => {
    const result = productSlugSchema.safeParse('сумка');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('invalid_slug');
  });
});

describe('skuSchema', () => {
  it('uppercases what a manager typed off a label', () => {
    expect(skuSchema.parse('sumka-liunet')).toBe('SUMKA-LIUNET');
    expect(skuSchema.parse('  cross-mini-blk ')).toBe('CROSS-MINI-BLK');
  });

  it('refuses spaces, punctuation and Cyrillic', () => {
    for (const raw of ['', 'SUMKA LIUNET', 'SUMKA_LIUNET', 'СУМКА', 'SUMKA--A', 'A'.repeat(41)]) {
      expect(skuSchema.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
    }
  });
});

describe('newProductSchema', () => {
  const fields = {
    title: 'Сумка «Люнет»',
    slug: 'sumka-liunet',
    basePrice: '1850',
    categoryId: '',
    status: 'draft',
  };

  it('accepts the five fields the create screen asks for', () => {
    const result = newProductSchema.safeParse(fields);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.basePrice).toBe(185_000);
      expect(result.data.categoryId).toBeNull();
      expect(result.data.status).toBe('draft');
    }
  });

  it('requires a title and a price — a product cannot exist without either', () => {
    expect(newProductSchema.safeParse({ ...fields, title: '   ' }).success).toBe(false);
    expect(newProductSchema.safeParse({ ...fields, basePrice: '' }).success).toBe(false);
  });
});

describe('product_save', () => {
  it('converts the price to kopiykas exactly once', () => {
    const result = saveProduct({ basePrice: '1850' });
    expect(result.success).toBe(true);
    if (result.success && result.data.intent === 'product_save') {
      expect(result.data.basePrice).toBe(185_000);
    }
  });

  it('accepts a price pasted with any separator formatPrice can emit', () => {
    for (const raw of ['12000', '12 000', '12 000', "12'000", '12’000']) {
      const result = saveProduct({ basePrice: raw });
      expect(result.success, JSON.stringify(raw)).toBe(true);
      if (result.success && result.data.intent === 'product_save') {
        expect(result.data.basePrice).toBe(1_200_000);
      }
    }
  });

  it('refuses a price that is not a whole number of hryvnias', () => {
    for (const raw of ['', '0', '-5', '18.50', '1850,00', 'abc', String(PRODUCT_PRICE_MAX_HRYVNIAS + 1)]) {
      expect(saveProduct({ basePrice: raw }).success, JSON.stringify(raw)).toBe(false);
    }
  });

  it('turns blank optional text into null', () => {
    const result = saveProduct({ dimensions: '   ', metaTitle: '' });
    expect(result.success).toBe(true);
    if (result.success && result.data.intent === 'product_save') {
      expect(result.data.dimensions).toBeNull();
      expect(result.data.metaTitle).toBeNull();
    }
  });

  it('reads an absent checkbox as false and `on` as true', () => {
    const off = saveProduct();
    if (off.success && off.data.intent === 'product_save') expect(off.data.isFeatured).toBe(false);

    const on = saveProduct({ isFeatured: 'on' });
    if (on.success && on.data.intent === 'product_save') expect(on.data.isFeatured).toBe(true);
  });

  it('reads the hide-from-search checkbox the same way', () => {
    const off = saveProduct();
    expect(off.success).toBe(true);
    if (off.success && off.data.intent === 'product_save') expect(off.data.hiddenFromSearch).toBe(false);

    const on = saveProduct({ hiddenFromSearch: 'on' });
    expect(on.success).toBe(true);
    if (on.success && on.data.intent === 'product_save') expect(on.data.hiddenFromSearch).toBe(true);
  });

  it('treats an empty category as no category', () => {
    const result = saveProduct({ categoryId: '' });
    if (result.success && result.data.intent === 'product_save') {
      expect(result.data.categoryId).toBeNull();
    }
    expect(saveProduct({ categoryId: 'not-a-uuid' }).success).toBe(false);
  });

  it('refuses a status outside the enum', () => {
    expect(saveProduct({ status: 'published' }).success).toBe(false);
  });
});

describe('variant intents', () => {
  it('accepts a variant with no colour at all', () => {
    const result = addVariant();
    expect(result.success).toBe(true);
    if (result.success && result.data.intent === 'variant_add') {
      expect(result.data.colorName).toBeNull();
      expect(result.data.colorHex).toBeNull();
      expect(result.data.priceOverride).toBeNull();
      expect(result.data.inStock).toBe(true);
    }
  });

  /**
   * An unticked checkbox posts nothing at all, so «немає в наявності» arrives
   * as an absent key — which must parse as `false` rather than fail the form.
   */
  it('reads a missing availability checkbox as out of stock', () => {
    const { inStock: _omitted, ...withoutBox } = VARIANT;
    const result = productActionSchema.safeParse(withoutBox);

    expect(result.success).toBe(true);
    if (result.success && result.data.intent === 'variant_add') {
      expect(result.data.inStock).toBe(false);
    }
  });

  it('refuses a box that is not one of the two', () => {
    expect(saveProduct({ parcelSize: 'medium' }).success).toBe(false);
    expect(saveProduct({ parcelSize: 'large' }).success).toBe(true);
  });

  it('normalises a colour swatch and refuses a malformed one', () => {
    const result = addVariant({ colorHex: '#1A1A1A' });
    if (result.success && result.data.intent === 'variant_add') {
      expect(result.data.colorHex).toBe('#1a1a1a');
    }
    for (const raw of ['1a1a1a', '#1a1a1', '#gggggg', 'black']) {
      expect(addVariant({ colorHex: raw }).success, raw).toBe(false);
    }
  });

  it('requires a real id on the intents that name an existing row', () => {
    const id = '4f1c7e2a-0000-4000-8000-000000000000';
    expect(
      productActionSchema.safeParse({ intent: 'variant_activate', variantId: id, active: '0' })
        .success,
    ).toBe(true);
    expect(
      productActionSchema.safeParse({ intent: 'variant_activate', variantId: 'nope', active: '0' })
        .success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({ intent: 'variant_activate', variantId: id, active: 'maybe' })
        .success,
    ).toBe(false);
  });
});

describe('image intents', () => {
  const imageId = '4f1c7e2a-0000-4000-8000-000000000001';

  it('carries no file field — bytes are checked elsewhere', () => {
    const result = productActionSchema.safeParse({ intent: 'image_add', alt: '', variantId: '' });
    expect(result.success).toBe(true);
    if (result.success && result.data.intent === 'image_add') {
      expect(result.data.variantId).toBeNull();
      expect(result.data.alt).toBeNull();
      expect('file' in result.data).toBe(false);
    }
  });

  /*
   * The body the *upload form* posts, built the way the page builds it. The
   * test above passes an `alt` no browser sends, which is how a required `alt`
   * survived both the suite and a curl pass while refusing every real upload.
   */
  it('accepts the upload form’s body, which carries no alt at all', () => {
    const form = new FormData();
    form.set('intent', 'image_add');
    form.set('file', new File([new Uint8Array([0])], 'photo.webp'));
    form.set('variantId', '');

    const result = productActionSchema.safeParse(Object.fromEntries(form));
    expect(result.success).toBe(true);
    if (result.success && result.data.intent === 'image_add') {
      expect(result.data.alt).toBeNull();
    }
  });

  it('only moves in the two directions the buttons offer', () => {
    expect(productActionSchema.safeParse({ intent: 'image_move', imageId, direction: 'up' }).success).toBe(true);
    expect(productActionSchema.safeParse({ intent: 'image_move', imageId, direction: 'top' }).success).toBe(false);
  });

  it('refuses an unknown intent outright', () => {
    expect(productActionSchema.safeParse({ intent: 'product_delete', imageId }).success).toBe(false);
  });
});

describe('categoryActionSchema', () => {
  const fields = {
    slug: 'sumky',
    title: 'Сумки',
    description: '',
    position: '0',
  };

  it('creates without an id and saves with one', () => {
    expect(categoryActionSchema.safeParse({ intent: 'category_create', ...fields }).success).toBe(true);
    expect(
      categoryActionSchema.safeParse({
        intent: 'category_save',
        categoryId: '4f1c7e2a-0000-4000-8000-000000000002',
        ...fields,
      }).success,
    ).toBe(true);
    expect(categoryActionSchema.safeParse({ intent: 'category_save', ...fields }).success).toBe(false);
  });
});

describe('product_save companion', () => {
  it('reads a blank percentage as 0, and caps it', () => {
    const blank = saveProduct({ companionDiscountPercent: '' });
    expect(blank.success && blank.data.intent === 'product_save' && blank.data.companionDiscountPercent).toBe(0);

    const set = saveProduct({ companionDiscountPercent: '20' });
    expect(set.success && set.data.intent === 'product_save' && set.data.companionDiscountPercent).toBe(20);

    expect(saveProduct({ companionDiscountPercent: '51' }).success).toBe(false);
  });

  it('adds and removes a companion by id, from the bodies the forms post', () => {
    const add = new FormData();
    add.set('intent', 'companion_add');
    add.set('companionProductId', '4f1c7e2a-0000-4000-8000-000000000009');
    expect(productActionSchema.safeParse(Object.fromEntries(add)).success).toBe(true);

    const empty = new FormData();
    empty.set('intent', 'companion_add');
    empty.set('companionProductId', '');
    expect(productActionSchema.safeParse(Object.fromEntries(empty)).success).toBe(false);
  });
});

describe('catalogFieldErrors', () => {
  it('points every refusal at the control that produced it', () => {
    const result = saveProduct({ title: '', slug: 'Сумка', basePrice: 'abc', position: '-1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(catalogFieldErrors(result.error)).toEqual(
        new Set(['title', 'slug', 'basePrice', 'position']),
      );
    }
  });

  it('reports nothing for a failure with no control to point at', () => {
    // `variantId` comes from a hidden field; a bad one means a tampered or
    // stale body, and the page shows a banner rather than marking an input.
    const result = productActionSchema.safeParse({
      intent: 'variant_activate',
      variantId: 'nope',
      active: '1',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(catalogFieldErrors(result.error).size).toBe(0);
  });
});
