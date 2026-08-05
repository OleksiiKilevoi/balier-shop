import { describe, expect, it } from 'vitest';
import {
  PRODUCT_PRICE_MAX_HRYVNIAS,
  STOCK_MAX,
  catalogFieldErrors,
  categoryActionSchema,
  newProductSchema,
  productActionSchema,
  productSlugSchema,
  skuSchema,
} from './catalog';

/**
 * The catalog forms are the first thing in the product that can write a price,
 * a stock level or a public URL, so what these schemas let through is what the
 * shop shows and charges.
 *
 * Two properties are worth more than the rest and get exact assertions rather
 * than round trips: **a price crosses into kopiykas here and nowhere else**, so
 * the numbers below are written out in full; and **an empty optional price is
 * `null`, never `0`** — `compare_at_price` and `price_override` are nullable
 * columns whose NULL means "not set", while zero would mean a free product.
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
  compareAtPrice: '',
  categoryId: '',
  status: 'active',
  position: '0',
} as const;

function saveProduct(overrides: Record<string, string> = {}) {
  return productActionSchema.safeParse({ ...BASE, ...overrides });
}

const VARIANT = {
  intent: 'variant_add',
  sku: 'SUMKA-LIUNET',
  colorName: '',
  colorHex: '',
  priceOverride: '',
  stock: '3',
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

  it('keeps an empty compare-at price as null rather than zero', () => {
    const result = saveProduct({ compareAtPrice: '' });
    expect(result.success).toBe(true);
    if (result.success && result.data.intent === 'product_save') {
      expect(result.data.compareAtPrice).toBeNull();
    }
  });

  it('still refuses a compare-at price that is present and wrong', () => {
    expect(saveProduct({ compareAtPrice: '0' }).success).toBe(false);
    expect(saveProduct({ compareAtPrice: 'abc' }).success).toBe(false);
    const result = saveProduct({ compareAtPrice: '2400' });
    if (result.success && result.data.intent === 'product_save') {
      expect(result.data.compareAtPrice).toBe(240_000);
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
      expect(result.data.stock).toBe(3);
    }
  });

  it('accepts zero stock but not a negative or absurd one', () => {
    expect(addVariant({ stock: '0' }).success).toBe(true);
    expect(addVariant({ stock: '-1' }).success).toBe(false);
    expect(addVariant({ stock: '1.5' }).success).toBe(false);
    expect(addVariant({ stock: String(STOCK_MAX + 1) }).success).toBe(false);
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
