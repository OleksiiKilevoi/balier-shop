import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../index';
import {
  categoryTranslations,
  productImages,
  productTranslations,
  productVariants,
  products,
} from '../schema';
import type { Kopiykas } from '~/lib/money';
import { availableStock } from './stock';

/**
 * The catalog ships Ukrainian only (see roadmap.md — the language switcher was
 * removed). The translation tables stay, so this constant is the single place a
 * request locale gets threaded through in Phase 6.
 */
const LOCALE = 'uk' as const;

/** A single buyable row. `id` is what the cart and every order reference. */
export interface ProductVariantData {
  id: string;
  sku: string;
  /** NULL when the product has no colour choice. */
  colorName: string | null;
  colorHex: string | null;
  /** Kopiykas, already resolved against `products.base_price`. */
  price: Kopiykas;
  available: number;
}

export interface ProductImageData {
  /** NULL = shared by every variant. Set = shown only for that colour. */
  variantId: string | null;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

/** Everything the product page renders. */
export interface ProductDetailData {
  slug: string;
  title: string;
  description: string | null;
  /** Newline-separated; rendered as a list. */
  details: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  categoryTitle: string | null;
  /** Free text exactly as written on the card, e.g. `30х17х10 см`. */
  dimensions: string | null;
  compareAtPrice: Kopiykas | null;
  /** Always at least one. There is no product-without-variants path. */
  variants: ProductVariantData[];
  images: ProductImageData[];
}

/** Everything `ProductCard` needs, and nothing else. */
export interface ProductCardData {
  slug: string;
  title: string;
  categoryTitle: string | null;
  /** Kopiykas. The cheapest active variant — what the card advertises. */
  price: Kopiykas;
  compareAtPrice: Kopiykas | null;
  imageUrl: string | null;
  imageAlt: string | null;
  /** Only variants that name a colour. A plain product yields an empty list. */
  swatches: { name: string; hex: string | null }[];
  inStock: boolean;
}

interface ProductCardRow {
  id: string;
  slug: string;
  basePrice: Kopiykas;
  compareAtPrice: Kopiykas | null;
  title: string;
  categoryTitle: string | null;
}

/**
 * The product half of a card row, joined to its Ukrainian text. Every listing
 * starts here and adds its own `where`/`orderBy`, so the grid and the search
 * results cannot drift apart in what they select or how they treat a product
 * that has no category.
 */
function selectProductCards(db: Db) {
  return db
    .select({
      id: products.id,
      slug: products.slug,
      basePrice: products.basePrice,
      compareAtPrice: products.compareAtPrice,
      title: productTranslations.title,
      categoryTitle: categoryTranslations.title,
    })
    .from(products)
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
    )
    // Left: a product may sit outside any category, and an untranslated category
    // must not make the product itself disappear from the grid.
    .leftJoin(
      categoryTranslations,
      and(
        eq(categoryTranslations.categoryId, products.categoryId),
        eq(categoryTranslations.locale, LOCALE),
      ),
    );
}

/**
 * Fills card rows out with their variants and lead image.
 *
 * Two extra round trips rather than one aggregate query: the catalog is tens of
 * products, and joining variants and images into the product row would either
 * multiply it out or need aggregation that is harder to read than the assembly
 * below. The two run in parallel.
 */
async function hydrateProductCards(
  db: Db,
  rows: ProductCardRow[],
): Promise<ProductCardData[]> {
  if (rows.length === 0) return [];

  const productIds = rows.map((row) => row.id);

  const [variants, images] = await Promise.all([
    db
      .select({
        productId: productVariants.productId,
        colorName: productVariants.colorName,
        colorHex: productVariants.colorHex,
        priceOverride: productVariants.priceOverride,
        available: availableStock(),
      })
      .from(productVariants)
      .where(
        and(inArray(productVariants.productId, productIds), eq(productVariants.isActive, true)),
      )
      .orderBy(asc(productVariants.position)),

    // One image per product — `DISTINCT ON` picks the lowest position instead of
    // pulling whole galleries the grid would throw away.
    db
      .selectDistinctOn([productImages.productId], {
        productId: productImages.productId,
        url: productImages.url,
        alt: productImages.alt,
      })
      .from(productImages)
      .where(inArray(productImages.productId, productIds))
      .orderBy(productImages.productId, asc(productImages.position), asc(productImages.id)),
  ]);

  const variantsByProduct = new Map<string, typeof variants>();
  for (const variant of variants) {
    const existing = variantsByProduct.get(variant.productId);
    if (existing) existing.push(variant);
    else variantsByProduct.set(variant.productId, [variant]);
  }

  const imageByProduct = new Map(images.map((image) => [image.productId, image]));

  return rows.map((row) => {
    const rowVariants = variantsByProduct.get(row.id) ?? [];
    const image = imageByProduct.get(row.id);

    const prices = rowVariants.map((variant) => variant.priceOverride ?? row.basePrice);

    return {
      slug: row.slug,
      title: row.title,
      categoryTitle: row.categoryTitle,
      price: prices.length > 0 ? Math.min(...prices) : row.basePrice,
      compareAtPrice: row.compareAtPrice,
      imageUrl: image?.url ?? null,
      imageAlt: image?.alt ?? null,
      swatches: rowVariants.flatMap((variant) =>
        variant.colorName ? [{ name: variant.colorName, hex: variant.colorHex }] : [],
      ),
      inStock: rowVariants.some((variant) => variant.available > 0),
    };
  });
}

/** The `/products` grid: every active product, in curated order. */
export async function listActiveProducts(db: Db): Promise<ProductCardData[]> {
  const rows = await selectProductCards(db)
    .where(eq(products.status, 'active'))
    .orderBy(asc(products.position), desc(products.createdAt));

  return hydrateProductCards(db, rows);
}

/**
 * Wraps a token in `%…%` and escapes the LIKE metacharacters, so a query of
 * `50%` looks for that text rather than for anything at all.
 *
 * Backslash is Postgres' default LIKE escape character, so no `ESCAPE` clause
 * is needed — but it does mean a literal backslash has to be doubled first.
 */
function likeContains(token: string): string {
  return `%${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * `/search`.
 *
 * Substring matching, not Postgres full-text search. FTS needs a dictionary to
 * stem with, Postgres ships none for Ukrainian, and the `simple` configuration
 * only lowercases — so «сумки» would not find «сумка», which is exactly the
 * lookup a shopper types. Matching on substrings gets that case right for free
 * and the catalog is tens of rows, so the sequential scan is not worth
 * engineering around. If it ever is, the fix is a `pg_trgm` GIN index over the
 * same expression, not a different matching rule.
 *
 * All tokens must match (`ILIKE ALL`), each anywhere in the product's title,
 * description, category or its variants' colour names and SKUs — so «чорна
 * сумка» narrows rather than widens.
 */
export async function searchProducts(db: Db, tokens: string[]): Promise<ProductCardData[]> {
  if (tokens.length === 0) return [];

  // Each pattern is its own bound parameter; only the array brackets are SQL.
  const patterns = sql`array[${sql.join(
    tokens.map((token) => sql`${likeContains(token)}`),
    sql`, `,
  )}]`;

  // Everything a query is allowed to hit, flattened to one string per product.
  // `concat_ws` drops the NULLs, so a product with no description or category
  // is still searchable by title.
  const haystack = sql`concat_ws(' ',
    ${productTranslations.title},
    ${productTranslations.description},
    ${categoryTranslations.title},
    (select string_agg(concat_ws(' ', ${productVariants.colorName}, ${productVariants.sku}), ' ')
       from ${productVariants}
      where ${productVariants.productId} = ${products.id}
        and ${productVariants.isActive})
  )`;

  // A title hit beats a hit buried in the description, so products are ranked by
  // how many of the tokens the title itself accounts for; ties fall back to the
  // catalog's own order.
  const titleHits = sql`(
    select count(*) from unnest(${patterns}) as pattern
     where ${productTranslations.title} ilike pattern
  )`;

  const rows = await selectProductCards(db)
    .where(and(eq(products.status, 'active'), sql`${haystack} ilike all (${patterns})`))
    .orderBy(desc(titleHits), asc(products.position), desc(products.createdAt));

  return hydrateProductCards(db, rows);
}

/**
 * One product page. Returns null for an unknown slug and for anything not
 * `active` — a draft or archived product must 404 rather than be reachable by
 * guessing its URL.
 *
 * A product whose variants are all deactivated also returns null: there would
 * be nothing to add to a cart, and every price on the page comes from a variant.
 */
export async function getProductBySlug(db: Db, slug: string): Promise<ProductDetailData | null> {
  const [row] = await db
    .select({
      id: products.id,
      slug: products.slug,
      basePrice: products.basePrice,
      compareAtPrice: products.compareAtPrice,
      dimensions: products.dimensions,
      title: productTranslations.title,
      description: productTranslations.description,
      details: productTranslations.details,
      metaTitle: productTranslations.metaTitle,
      metaDescription: productTranslations.metaDescription,
      categoryTitle: categoryTranslations.title,
    })
    .from(products)
    .innerJoin(
      productTranslations,
      and(
        eq(productTranslations.productId, products.id),
        eq(productTranslations.locale, LOCALE),
      ),
    )
    .leftJoin(
      categoryTranslations,
      and(
        eq(categoryTranslations.categoryId, products.categoryId),
        eq(categoryTranslations.locale, LOCALE),
      ),
    )
    .where(and(eq(products.slug, slug), eq(products.status, 'active')))
    .limit(1);

  if (!row) return null;

  const [variants, images] = await Promise.all([
    db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        colorName: productVariants.colorName,
        colorHex: productVariants.colorHex,
        priceOverride: productVariants.priceOverride,
        available: availableStock(),
      })
      .from(productVariants)
      .where(and(eq(productVariants.productId, row.id), eq(productVariants.isActive, true)))
      .orderBy(asc(productVariants.position), asc(productVariants.sku)),

    db
      .select({
        variantId: productImages.variantId,
        url: productImages.url,
        alt: productImages.alt,
        width: productImages.width,
        height: productImages.height,
      })
      .from(productImages)
      .where(eq(productImages.productId, row.id))
      .orderBy(asc(productImages.position), asc(productImages.id)),
  ]);

  if (variants.length === 0) return null;

  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    details: row.details,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    categoryTitle: row.categoryTitle,
    dimensions: row.dimensions,
    compareAtPrice: row.compareAtPrice,
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      colorName: variant.colorName,
      colorHex: variant.colorHex,
      price: variant.priceOverride ?? row.basePrice,
      available: variant.available,
    })),
    images,
  };
}
