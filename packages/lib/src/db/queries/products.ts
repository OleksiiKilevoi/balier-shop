import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../index';
import type { ParcelSize } from '../schema';
import { leadImages } from '../../products/feedImage';
import {
  categories,
  categoryTranslations,
  productImages,
  productTranslations,
  productVariants,
  products,
} from '../schema';
import type { Kopiykas } from '../../money';
import { followingInOrder } from '../../products/related';
import { likeContains } from './like';
import { LOCALE } from './locale';
import { VARIANT_NAME_SQL } from './variantName';

/** A single buyable row. `id` is what the cart and every order reference. */
export interface ProductVariantData {
  id: string;
  sku: string;
  /** NULL when the product has no colour choice. */
  colorName: string | null;
  colorHex: string | null;
  /** NULL when the product comes in one size. */
  size: string | null;
  /** This size's own measurements; NULL = the product's `dimensions`. */
  dimensions: string | null;
  /** Kopiykas, already resolved against `products.base_price`. */
  price: Kopiykas;
  /** The manager's flag, verbatim — there is no count behind it. */
  inStock: boolean;
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
  /** NULL when there is no category *page* to link to (none set, or deactivated). */
  categorySlug: string | null;
  /** Free text exactly as written on the card, e.g. `30х17х10 см`. */
  dimensions: string | null;
  /** The Nova Poshta box it ships in — prices the delivery in the page's structured data. */
  parcelSize: ParcelSize;
  /** An add-on kept out of search (`products.hidden_from_search`): its page is `noindex`. */
  hiddenFromSearch: boolean;
  id: string;
  /** The bundle discount on this product's companions (`~/lib/cart/bundle.ts`). */
  companionDiscountPercent: number;
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
        inStock: productVariants.inStock,
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
      imageUrl: image?.url ?? null,
      imageAlt: image?.alt ?? null,
      // One swatch per colour, however many sizes it comes in.
      swatches: [
        ...new Map(
          rowVariants.flatMap((variant) =>
            variant.colorName ? [[variant.colorName, { name: variant.colorName, hex: variant.colorHex }] as const] : [],
          ),
        ).values(),
      ],
      inStock: rowVariants.some((variant) => variant.inStock),
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
 * The sitemap's product entries: each active product's slug, when its page
 * last changed — the later of the product row and any of its variants, since a
 * price or stock edit lives on the variant — and its photo URLs in gallery
 * order, for the `<image:image>` entries. Both dates are written explicitly on
 * every panel save (see `./adminProducts.ts`), so the date is a real edit
 * time, not the seed date.
 */
export async function listSitemapProducts(
  db: Db,
): Promise<{ slug: string; updatedAt: Date; imageUrls: string[] }[]> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      updatedAt: sql<Date>`greatest(${products.updatedAt}, max(${productVariants.updatedAt}))`.mapWith(
        (value: string | Date) => new Date(value),
      ),
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .where(and(eq(products.status, 'active'), eq(products.hiddenFromSearch, false)))
    .groupBy(products.id)
    .orderBy(asc(products.position), desc(products.createdAt));
  if (rows.length === 0) return [];

  const images = await db
    .select({ productId: productImages.productId, url: productImages.url })
    .from(productImages)
    .where(inArray(productImages.productId, rows.map((row) => row.id)))
    .orderBy(asc(productImages.position), asc(productImages.id));

  return rows.map(({ id, slug, updatedAt }) => ({
    slug,
    updatedAt,
    imageUrls: images.filter((image) => image.productId === id).map((image) => image.url),
  }));
}

/** «Усі товари» in the category nav — products without a category included. */
export async function countActiveProducts(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.status, 'active'));
  return row?.count ?? 0;
}

/** The `/products/category/[slug]` grid: one category, same order as `/products`. */
export async function listProductsInCategory(
  db: Db,
  categoryId: string,
): Promise<ProductCardData[]> {
  const rows = await selectProductCards(db)
    .where(and(eq(products.status, 'active'), eq(products.categoryId, categoryId)))
    .orderBy(asc(products.position), desc(products.createdAt));

  return hydrateProductCards(db, rows);
}

/**
 * «Ще з категорії» on a product page: up to `limit` other products from the
 * same category, the ones after it in the category's order (see
 * `followingInOrder`). Products kept out of search are left out — the block
 * exists for internal linking, and a link to a `noindex` add-on is wasted.
 * The category is the product's own, looked up here so the page needs no id
 * it does not otherwise have.
 */
export async function listRelatedProducts(
  db: Db,
  productSlug: string,
  limit: number,
): Promise<ProductCardData[]> {
  const self = alias(products, 'self');
  const rows = await selectProductCards(db)
    .where(
      and(
        eq(products.status, 'active'),
        eq(products.hiddenFromSearch, false),
        inArray(
          products.categoryId,
          db.select({ categoryId: self.categoryId }).from(self).where(eq(self.slug, productSlug)),
        ),
      ),
    )
    .orderBy(asc(products.position), desc(products.createdAt));

  return hydrateProductCards(db, followingInOrder(rows, productSlug, limit));
}

/**
 * The homepage row.
 *
 * `is_featured DESC` rather than `where is_featured`: the flag floats a product
 * to the front of the row, it does not gate the row's existence. A client who
 * has flagged nothing, flagged two, or archived the three they had flagged still
 * gets a full, correctly-sized grid of the newest products instead of an empty
 * section — the section cannot be broken from the admin panel, only reordered.
 *
 * There is deliberately no limit on how many products may carry the flag. A
 * database constraint on that would hand the client an error dialog and no way
 * to see which slots are taken; the extras simply fall past `limit`.
 */
export async function listFeaturedProducts(db: Db, limit: number): Promise<ProductCardData[]> {
  const rows = await selectProductCards(db)
    .where(eq(products.status, 'active'))
    .orderBy(desc(products.isFeatured), asc(products.position), desc(products.createdAt))
    .limit(limit);

  return hydrateProductCards(db, rows);
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
    (select string_agg(concat_ws(' ', ${productVariants.colorName}, ${productVariants.size}, ${productVariants.sku}), ' ')
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

/** One buyable line in the admin panel's product picker. */
export interface AdminVariantResult {
  variantId: string;
  sku: string;
  productTitle: string;
  /** «Чорний · M» — `variantLabel`; NULL for a product with one plain variant. */
  variantName: string | null;
  price: Kopiykas;
  inStock: boolean;
}

/**
 * The product picker on `/admin/orders/new` — the same substring matching
 * `searchProducts` uses (see its comment for why not full-text), but resolved
 * to **variants** rather than products, because a variant is what an order line
 * references and what carries its own price and availability.
 *
 * Filtered exactly like `lockCheckoutVariants`: active variants of active
 * products, and nothing else. A looser filter here would let a manager add a
 * draft product to a basket and then be refused at the last step with
 * `cart_changed`, which reads as a bug rather than as a rule.
 *
 * Out-of-stock variants *are* returned — the row says so next to the price, and
 * hiding them would leave a manager searching for something they can see in
 * the catalog with no explanation. Adding one is refused when the order is
 * created, by the same repricing every checkout goes through.
 */
export async function searchAdminVariants(
  db: Db,
  tokens: string[],
  limit = 20,
): Promise<AdminVariantResult[]> {
  if (tokens.length === 0) return [];

  const patterns = sql`array[${sql.join(
    tokens.map((token) => sql`${likeContains(token)}`),
    sql`, `,
  )}]`;

  // Title, colour, size and SKU: what a manager reads off a chat message.
  const haystack = sql`concat_ws(' ',
    ${productTranslations.title},
    ${productVariants.colorName},
    ${productVariants.size},
    ${productVariants.sku}
  )`;

  return db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      productTitle: productTranslations.title,
      variantName: VARIANT_NAME_SQL,
      price: sql<number>`coalesce(${productVariants.priceOverride}, ${products.basePrice})`,
      inStock: productVariants.inStock,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
    )
    .where(
      and(
        eq(productVariants.isActive, true),
        eq(products.status, 'active'),
        sql`${haystack} ilike all (${patterns})`,
      ),
    )
    .orderBy(asc(productTranslations.title), asc(productVariants.position), asc(productVariants.sku))
    .limit(limit);
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
      dimensions: products.dimensions,
      parcelSize: products.parcelSize,
      hiddenFromSearch: products.hiddenFromSearch,
      title: productTranslations.title,
      description: productTranslations.description,
      details: productTranslations.details,
      metaTitle: productTranslations.metaTitle,
      metaDescription: productTranslations.metaDescription,
      categoryTitle: categoryTranslations.title,
      categorySlug: categories.slug,
      companionDiscountPercent: products.companionDiscountPercent,
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
    // Deactivating a category keeps the pill's text but drops its link — the
    // page it would point at 404s, and the product itself must not vanish.
    .leftJoin(
      categories,
      and(eq(categories.id, products.categoryId), eq(categories.isActive, true)),
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
        size: productVariants.size,
        dimensions: productVariants.dimensions,
        priceOverride: productVariants.priceOverride,
        inStock: productVariants.inStock,
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
    categorySlug: row.categorySlug,
    dimensions: row.dimensions,
    parcelSize: row.parcelSize,
    hiddenFromSearch: row.hiddenFromSearch,
    id: row.id,
    companionDiscountPercent: row.companionDiscountPercent,
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      colorName: variant.colorName,
      colorHex: variant.colorHex,
      size: variant.size,
      dimensions: variant.dimensions,
      price: variant.priceOverride ?? row.basePrice,
      inStock: variant.inStock,
    })),
    images,
  };
}

/** One row per active variant of an active product — what the Google feed lists. */
export interface FeedVariantData {
  sku: string;
  productId: string;
  slug: string;
  title: string;
  description: string | null;
  colorName: string | null;
  size: string | null;
  price: Kopiykas;
  inStock: boolean;
  /** The variant's own photo, else its colour's, else the product's (`leadImages`). Relative. */
  imageUrl: string | null;
}

export async function listFeedVariants(db: Db): Promise<FeedVariantData[]> {
  const rows = await db
    .select({
      sku: productVariants.sku,
      variantId: productVariants.id,
      productId: products.id,
      slug: products.slug,
      title: productTranslations.title,
      description: productTranslations.description,
      colorName: productVariants.colorName,
      size: productVariants.size,
      price: sql<number>`coalesce(${productVariants.priceOverride}, ${products.basePrice})`,
      inStock: productVariants.inStock,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
    )
    // Add-ons kept out of search stay out of Google Shopping too.
    .where(
      and(
        eq(products.status, 'active'),
        eq(productVariants.isActive, true),
        eq(products.hiddenFromSearch, false),
      ),
    )
    .orderBy(asc(products.position), asc(productVariants.position));
  if (rows.length === 0) return [];

  // Whole galleries, lowest position first: tens of products, one round trip.
  const images = await db
    .select({ productId: productImages.productId, variantId: productImages.variantId, url: productImages.url })
    .from(productImages)
    .where(inArray(productImages.productId, [...new Set(rows.map((row) => row.productId))]))
    .orderBy(asc(productImages.position), asc(productImages.id));

  const lead = leadImages(rows, images);
  return rows.map(({ variantId, ...row }) => ({ ...row, imageUrl: lead.get(variantId) ?? null }));
}
