import { z } from 'zod';
import { parcelSize, productStatus } from '../db/schema';
import { SKU_MAX_LENGTH, SLUG_MAX_LENGTH } from '../products/slug';
import { optionalWholeHryvniaSchema, wholeHryvniaSchema } from './money';

/**
 * Everything the catalog screens POST: the product editor, its variant and
 * image rows, and the categories page.
 *
 * Like the order screens, these arrive as HTML form bodies, so every value
 * starts as a string and an unchecked checkbox is an *absent* key rather than a
 * false one. Unlike them, each form here is flat — one intent, one level of
 * fields — which is what lets `catalogFieldErrors` be a lookup on the issue's
 * path head instead of the union-walking `adminOrderFieldErrors` has to do.
 */

/* ------------------------------------------------------------ shared pieces */

/** Text a manager may leave blank, where blank means NULL rather than `''`. */
function optionalText(max: number) {
  return z
    .string()
    .max(max)
    .transform((raw) => raw.trim())
    .transform((value): string | null => (value === '' ? null : value));
}

/** An HTML checkbox: present (`on`) or missing entirely. */
const checkbox = z
  .string()
  .optional()
  .transform((value) => value === 'on');

function wholeNumber(max: number, error: string) {
  return z
    .string()
    .transform((raw) => raw.replace(/[\s '’]/g, ''))
    .refine((value) => /^\d+$/.test(value), error)
    .transform(Number)
    .refine((value) => value <= max, error);
}

/**
 * A whole number the manager may leave blank, where blank means NULL rather
 * than zero. Written for the variant's weight, where the difference is the
 * point: NULL is «not weighed yet» and refuses a waybill by name, while 0 would
 * be a claim about physics — so zero is rejected along with everything else
 * that is not a positive count.
 */
function optionalWholeNumber(max: number, error: string) {
  return z
    .string()
    .transform((raw) => raw.replace(/[\s '’]/g, ''))
    .refine((value) => value === '' || /^\d+$/.test(value), error)
    .transform((value): number | null => (value === '' ? null : Number(value)))
    .refine((value) => value === null || (value >= 1 && value <= max), error);
}

/**
 * A `<select>` whose empty option means «none». Kept as a plain uuid check
 * rather than a lookup: whether the id names a row that still exists is a
 * question for the database, and the foreign key answers it definitively.
 */
const optionalId = z
  .string()
  .transform((raw) => raw.trim())
  .refine((value) => value === '' || z.uuid().safeParse(value).success, 'invalid_id')
  .transform((value): string | null => (value === '' ? null : value));

const requiredId = z.uuid('invalid_id');

/* -------------------------------------------------------------- the product */

export const PRODUCT_PRICE_MIN_HRYVNIAS = 1;
export const PRODUCT_PRICE_MAX_HRYVNIAS = 1_000_000;
export const POSITION_MAX = 9_999;

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 4_000;
export const DETAILS_MAX = 2_000;
export const DIMENSIONS_MAX = 100;
export const META_TITLE_MAX = 200;
export const META_DESCRIPTION_MAX = 300;
export const COLOR_NAME_MAX = 60;
/** «S», «XL», «Mini», «13″» — a label on a button, not a description. */
export const SIZE_MAX = 20;
export const ALT_MAX = 300;

/**
 * Lowercase latin, digits and single hyphens. This is what ends up in
 * `/products/<slug>`, so it is checked rather than sanitised: silently rewriting
 * what a manager typed would mean the field and the URL disagree.
 */
export const productSlugSchema = z
  .string()
  .transform((raw) => raw.trim().toLowerCase())
  .refine(
    (value) => value.length >= 1 && value.length <= SLUG_MAX_LENGTH,
    'invalid_slug',
  )
  .refine((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), 'invalid_slug');

/**
 * Uppercase latin, digits and single hyphens. Uppercased for the manager rather
 * than refused, since a SKU read off a label is often typed in lower case and
 * the case carries no meaning.
 */
export const skuSchema = z
  .string()
  .transform((raw) => raw.trim().toUpperCase())
  .refine((value) => value.length >= 1 && value.length <= SKU_MAX_LENGTH, 'invalid_sku')
  .refine((value) => /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(value), 'invalid_sku');

const colorHexSchema = z
  .string()
  .transform((raw) => raw.trim().toLowerCase())
  .refine((value) => value === '' || /^#[0-9a-f]{6}$/.test(value), 'invalid_color_hex')
  .transform((value): string | null => (value === '' ? null : value));

const priceSchema = wholeHryvniaSchema({
  min: PRODUCT_PRICE_MIN_HRYVNIAS,
  max: PRODUCT_PRICE_MAX_HRYVNIAS,
  error: 'invalid_price',
});

const optionalPriceSchema = optionalWholeHryvniaSchema({
  min: PRODUCT_PRICE_MIN_HRYVNIAS,
  max: PRODUCT_PRICE_MAX_HRYVNIAS,
  error: 'invalid_price',
});

/** The five fields `/admin/products/new` asks for before a product can exist. */
export const newProductSchema = z.object({
  title: z.string().trim().min(1, 'invalid_title').max(TITLE_MAX, 'invalid_title'),
  slug: productSlugSchema,
  basePrice: priceSchema,
  categoryId: optionalId,
  status: z.enum(productStatus.enumValues),
});

/** Matches the `products_companion_discount_range` check. */
export const COMPANION_DISCOUNT_MAX = 50;

const productSaveSchema = z.object({
  intent: z.literal('product_save'),
  title: z.string().trim().min(1, 'invalid_title').max(TITLE_MAX, 'invalid_title'),
  slug: productSlugSchema,
  description: optionalText(DESCRIPTION_MAX),
  details: optionalText(DETAILS_MAX),
  dimensions: optionalText(DIMENSIONS_MAX),
  metaTitle: optionalText(META_TITLE_MAX),
  metaDescription: optionalText(META_DESCRIPTION_MAX),
  basePrice: priceSchema,
  categoryId: optionalId,
  parcelSize: z.enum(parcelSize.enumValues, 'invalid_parcel_size'),
  status: z.enum(productStatus.enumValues),
  isFeatured: checkbox,
  position: wholeNumber(POSITION_MAX, 'invalid_position'),
  /** On every companion in the list below the form (`~/lib/cart/bundle.ts`). */
  companionDiscountPercent: z
    .string()
    .transform((raw) => raw.trim() || '0')
    .pipe(wholeNumber(COMPANION_DISCOUNT_MAX, 'invalid_companion_discount')),
});

/* ------------------------------------------------------------- the variants */

const variantFields = {
  sku: skuSchema,
  colorName: optionalText(COLOR_NAME_MAX),
  colorHex: colorHexSchema,
  size: optionalText(SIZE_MAX),
  dimensions: optionalText(DIMENSIONS_MAX),
  priceOverride: optionalPriceSchema,
  /**
   * A checkbox, so «немає в наявності» is the *absent* key — which is exactly
   * what an unticked box posts, and what a `variant_add` form with no box at
   * all would post too. The add form therefore renders one, ticked: a new
   * colour nobody has said anything about is for sale, which is also the
   * column's default.
   */
  inStock: checkbox,
  position: wholeNumber(POSITION_MAX, 'invalid_position'),
};

const variantAddSchema = z.object({ intent: z.literal('variant_add'), ...variantFields });

const variantSaveSchema = z.object({
  intent: z.literal('variant_save'),
  variantId: requiredId,
  ...variantFields,
});

/**
 * Separate from `variant_save` on purpose. Activating and deactivating is the
 * one variant action with a consequence outside its own row — the last active
 * variant of a published product is what keeps that product resolvable at all —
 * so it is its own intent, its own button, and its own check in the query layer.
 */
const variantActivateSchema = z.object({
  intent: z.literal('variant_activate'),
  variantId: requiredId,
  active: z.enum(['0', '1']).transform((value) => value === '1'),
});

/* --------------------------------------------------------------- the images */

/**
 * The uploaded file itself is deliberately absent from this schema. It arrives
 * as a `File` in a multipart body, not as a string, and its rules are about
 * bytes and pixels rather than shape — `~/lib/media/upload` owns those, because
 * they can only be checked after the image has been decoded.
 */
const imageAddSchema = z.object({
  intent: z.literal('image_add'),
  /*
   * Absent, not blank — and that is this form's *normal* body rather than a
   * tampered one. The upload control asks for a file and who it belongs to;
   * the description is written afterwards, in the row the upload creates, and
   * `image_save` below is where it is a field. A required `alt` here refused
   * every upload a browser ever made with «Не вдалося зберегти зміни.» while
   * the same POST from `curl -F alt=…` went through, which is exactly how the
   * screen passed its first pass and still could not upload a photo.
   */
  alt: optionalText(ALT_MAX)
    .optional()
    .transform((value) => value ?? null),
  variantId: optionalId,
});

const imageSaveSchema = z.object({
  intent: z.literal('image_save'),
  imageId: requiredId,
  alt: optionalText(ALT_MAX),
  variantId: optionalId,
});

const imageMoveSchema = z.object({
  intent: z.literal('image_move'),
  imageId: requiredId,
  direction: z.enum(['up', 'down']),
});

const imageRemoveSchema = z.object({
  intent: z.literal('image_remove'),
  imageId: requiredId,
});

/* ------------------------------------------------------------ the companions */

const companionAddSchema = z.object({
  intent: z.literal('companion_add'),
  companionProductId: requiredId,
});

const companionRemoveSchema = z.object({
  intent: z.literal('companion_remove'),
  companionProductId: requiredId,
});

/* ------------------------------------------------------------- the assembly */

export const productActionSchema = z.discriminatedUnion('intent', [
  productSaveSchema,
  variantAddSchema,
  variantSaveSchema,
  variantActivateSchema,
  imageAddSchema,
  imageSaveSchema,
  imageMoveSchema,
  imageRemoveSchema,
  companionAddSchema,
  companionRemoveSchema,
]);

export type ProductAction = z.infer<typeof productActionSchema>;

/* ------------------------------------------------------------- the category */

const categoryFields = {
  slug: productSlugSchema,
  title: z.string().trim().min(1, 'invalid_title').max(TITLE_MAX, 'invalid_title'),
  description: optionalText(DESCRIPTION_MAX),
  position: wholeNumber(POSITION_MAX, 'invalid_position'),
  isActive: checkbox,
};

export const categoryActionSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('category_create'), ...categoryFields }),
  z.object({ intent: z.literal('category_save'), categoryId: requiredId, ...categoryFields }),
]);

/* ---------------------------------------------------------- error placement */

/**
 * Every control on the catalog screens that can carry its own message. `title`,
 * `slug` and `position` appear on both the product form and the category form,
 * and `position` on the variant rows as well — which is fine, because one form
 * posts at a time and a page only ever renders the errors of the intent it just
 * refused.
 */
const CATALOG_FIELDS = [
  'title',
  'slug',
  'description',
  'details',
  'dimensions',
  'metaTitle',
  'metaDescription',
  'basePrice',
  'categoryId',
  'parcelSize',
  'position',
  'companionProductId',
  'companionDiscountPercent',
  'sku',
  'colorName',
  'colorHex',
  'size',
  'priceOverride',
  'alt',
] as const;

export type CatalogField = (typeof CATALOG_FIELDS)[number];

const FIELD_SET = new Set<string>(CATALOG_FIELDS);

/**
 * Sorts Zod's issues onto the controls that rendered them.
 *
 * Simpler than its order-form counterpart because these objects are flat: the
 * head of the path *is* the field name. An issue on `intent`, `variantId` or
 * `imageId` has no control to point at — those come from hidden fields and a
 * failure means a tampered or stale body — so it falls out here and the page
 * shows a banner instead.
 */
export function catalogFieldErrors(error: z.ZodError): Set<CatalogField> {
  const fields = new Set<CatalogField>();

  for (const issue of error.issues) {
    const head = issue.path[0];
    if (typeof head === 'string' && FIELD_SET.has(head)) fields.add(head as CatalogField);
  }

  return fields;
}
