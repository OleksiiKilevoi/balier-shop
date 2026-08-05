import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db, Tx, TxDb } from '../index';
import type { Category, Product, ProductImage, ProductStatus, ProductVariant } from '../schema';
import {
  categories,
  categoryTranslations,
  productImages,
  productTranslations,
  productVariants,
  products,
} from '../schema';
import type { Kopiykas } from '~/lib/money';
import { likeContains } from './like';
import { LOCALE } from './locale';
import { uniqueConstraint } from './unique';

/**
 * The catalog's write path, and the reads that only the admin panel does.
 *
 * Until this file existed nothing in the running application could create or
 * change a product: `scripts/seed.ts` was the only writer, it only ever ran from
 * a developer's machine, and every insert in it was `onConflictDoNothing`, so it
 * could not even correct itself. `./products.ts` next door is the storefront's
 * read path and stays that way — it filters to `active` products and active
 * variants, which is exactly what the panel must *not* do.
 *
 * Two rules run through everything here:
 *
 *  - **`updatedAt` is always written explicitly.** The schema attaches no
 *    `$onUpdate` to any table, so the column defaults on INSERT only; an update
 *    that forgot it would keep reporting the moment the row was seeded. The
 *    same trap is documented in `./settings.ts`.
 *  - **Nothing is deleted except an image.** Archiving is the rule the panel
 *    ships (`products.status`, `product_variants.is_active`), which keeps order
 *    history intact by construction — `order_items.variant_id` is
 *    `ON DELETE restrict`, so a variant that has ever been ordered could not be
 *    removed anyway. An image row is not history and nothing references it.
 */

/* ------------------------------------------------------------------- errors */

export type CatalogFailure =
  | 'slug_taken'
  | 'sku_taken'
  | 'not_found'
  | 'last_active_variant'
  | 'conflict';

export type CatalogResult = { ok: true } | { ok: false; reason: CatalogFailure };

/**
 * Uniqueness is caught rather than pre-checked — see `./unique.ts` for why, and
 * for the wrapping that makes reading the error less obvious than it looks.
 *
 * Matched on the constraint *name* containing `slug`/`sku` rather than on the
 * exact string, so renaming a constraint in a future migration degrades to the
 * generic message instead of to a 500.
 */
function uniqueFailure(error: unknown): CatalogFailure | null {
  const constraint = uniqueConstraint(error);
  if (constraint === null) return null;

  if (constraint.includes('slug')) return 'slug_taken';
  if (constraint.includes('sku')) return 'sku_taken';
  return 'conflict';
}

/** Runs a write, turning a uniqueness collision into a result instead of a throw. */
async function guarded(write: () => Promise<void>): Promise<CatalogResult> {
  try {
    await write();
    return { ok: true };
  } catch (error) {
    const failure = uniqueFailure(error);
    if (failure) return { ok: false, reason: failure };
    throw error;
  }
}

/* -------------------------------------------------------------------- reads */

/** One row of `/admin/products`. */
export interface AdminProductRow {
  id: string;
  slug: string;
  title: string;
  status: ProductStatus;
  categoryTitle: string | null;
  basePrice: Kopiykas;
  /** What the storefront card would advertise — the cheapest *active* variant. */
  displayPrice: Kopiykas;
  isFeatured: boolean;
  position: number;
  variantCount: number;
  activeVariantCount: number;
  /** Physical units across active variants; reservations are not subtracted. */
  totalStock: number;
  imageUrl: string | null;
  updatedAt: Date;
}

export interface AdminProductList {
  rows: AdminProductRow[];
  total: number;
}

/**
 * The product list: every product regardless of status, newest edit first, with
 * the two numbers a manager scans for — how many variants and how much stock.
 *
 * Search covers title, slug and SKU, which is what someone has in front of them:
 * a name from a chat message, a URL from the shop, or a code off a label.
 * Substring matching, like `/search` and the order list, and for the same
 * reason — the catalog is small and an operator types fragments.
 *
 * The category is a separate filter rather than part of that text: it matches on
 * `category_id`, so «показати» on `/admin/categories` lands on exactly the rows
 * the count promised. Folding it into the search would have matched the category
 * *name* against product titles, which finds nothing.
 */
export async function listAdminProducts(
  db: Db,
  options: {
    status?: ProductStatus;
    categoryId?: string;
    query?: string;
    limit: number;
    offset: number;
  },
): Promise<AdminProductList> {
  const filters: SQL[] = [];

  if (options.status) filters.push(eq(products.status, options.status));
  if (options.categoryId) filters.push(eq(products.categoryId, options.categoryId));

  const query = options.query?.trim();
  if (query) {
    const text = likeContains(query);
    filters.push(sql`(
      ${productTranslations.title} ilike ${text}
      or ${products.slug} ilike ${text}
      or exists (
        select 1 from ${productVariants}
         where ${productVariants.productId} = ${products.id}
           and ${productVariants.sku} ilike ${text}
      )
    )`);
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  /*
   * Join and group rather than correlated subqueries in the `select` — inside a
   * select field Drizzle renders column references unqualified, which silently
   * resolves both sides of a subquery's `where` to the inner table. That bug
   * shipped once already, as an item count that was always 0 on the order list.
   *
   * The `exists` in the search filter above is safe from it because a `where`
   * *is* qualified; it is the select position that is not.
   */
  const activeVariant = sql`${productVariants.isActive}`;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: products.id,
        slug: products.slug,
        title: productTranslations.title,
        status: products.status,
        categoryTitle: categoryTranslations.title,
        basePrice: products.basePrice,
        isFeatured: products.isFeatured,
        position: products.position,
        updatedAt: products.updatedAt,
        variantCount: sql<number>`count(${productVariants.id})::int`,
        activeVariantCount: sql<number>`count(${productVariants.id}) filter (where ${activeVariant})::int`,
        totalStock: sql<number>`coalesce(sum(${productVariants.stock}) filter (where ${activeVariant}), 0)::int`,
        displayPrice: sql<number>`coalesce(
          min(coalesce(${productVariants.priceOverride}, ${products.basePrice}))
            filter (where ${activeVariant}),
          ${products.basePrice}
        )::int`,
      })
      .from(products)
      .innerJoin(
        productTranslations,
        and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
      )
      .leftJoin(
        categoryTranslations,
        and(
          eq(categoryTranslations.categoryId, products.categoryId),
          eq(categoryTranslations.locale, LOCALE),
        ),
      )
      .leftJoin(productVariants, eq(productVariants.productId, products.id))
      .where(where)
      .groupBy(products.id, productTranslations.title, categoryTranslations.title)
      .orderBy(desc(products.updatedAt))
      .limit(options.limit)
      .offset(options.offset),

    db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(
        productTranslations,
        and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
      )
      .where(where),
  ]);

  // The lead image, separately — `DISTINCT ON` picks the lowest position rather
  // than pulling whole galleries the list would throw away. Same shape the
  // storefront's card hydration uses.
  const ids = rows.map((row) => row.id);
  const images =
    ids.length === 0
      ? []
      : await db
          .selectDistinctOn([productImages.productId], {
            productId: productImages.productId,
            url: productImages.url,
          })
          .from(productImages)
          .where(inArray(productImages.productId, ids))
          .orderBy(productImages.productId, asc(productImages.position), asc(productImages.id));

  const imageByProduct = new Map(images.map((image) => [image.productId, image.url]));

  return {
    rows: rows.map((row) => ({ ...row, imageUrl: imageByProduct.get(row.id) ?? null })),
    total: counted?.total ?? 0,
  };
}

export interface AdminProductDetail {
  product: Product;
  /** The `uk` row. Absent only on a product created outside the panel. */
  translation: {
    title: string;
    description: string | null;
    details: string | null;
    metaTitle: string | null;
    metaDescription: string | null;
  } | null;
  category: Category | null;
  /** Every variant, inactive ones included — the panel is where they come back. */
  variants: ProductVariant[];
  images: ProductImage[];
}

/**
 * One product, as the editor needs it: everything, unfiltered.
 *
 * Uses the relations declared in the schema, which nothing had called before —
 * the storefront's `getProductBySlug` hand-joins because it needs the `active`
 * filters woven into the joins themselves, and here there are none.
 */
export async function findAdminProduct(db: Db, id: string): Promise<AdminProductDetail | null> {
  const row = await db.query.products.findFirst({
    where: (p, { eq: eqCol }) => eqCol(p.id, id),
    with: {
      translations: true,
      category: true,
      variants: { orderBy: (v, { asc: ascCol }) => [ascCol(v.position), ascCol(v.sku)] },
      images: { orderBy: (i, { asc: ascCol }) => [ascCol(i.position), ascCol(i.id)] },
    },
  });

  if (!row) return null;

  const translation = row.translations.find((entry) => entry.locale === LOCALE) ?? null;

  return {
    product: row,
    translation: translation
      ? {
          title: translation.title,
          description: translation.description,
          details: translation.details,
          metaTitle: translation.metaTitle,
          metaDescription: translation.metaDescription,
        }
      : null,
    category: row.category ?? null,
    variants: row.variants,
    images: row.images,
  };
}

/** The category picker on the product form — every category, active or not. */
export async function listCategoryOptions(
  db: Db,
): Promise<{ id: string; title: string; isActive: boolean }[]> {
  return db
    .select({
      id: categories.id,
      title: categoryTranslations.title,
      isActive: categories.isActive,
    })
    .from(categories)
    .innerJoin(
      categoryTranslations,
      and(
        eq(categoryTranslations.categoryId, categories.id),
        eq(categoryTranslations.locale, LOCALE),
      ),
    )
    .orderBy(asc(categories.position), asc(categoryTranslations.title));
}

/* ------------------------------------------------------------------- writes */

export interface NewProductFields {
  slug: string;
  title: string;
  basePrice: Kopiykas;
  categoryId: string | null;
  status: ProductStatus;
  /** The first variant's code. A product cannot exist without one. */
  sku: string;
}

/**
 * Creates a product, its Ukrainian text and its first variant in one
 * transaction.
 *
 * The variant is not optional and not a later step: the schema's own comment
 * says every product has at least one, because stock, SKU and every cart and
 * order reference hang off the variant rather than the product. A product row
 * with no variant is not a half-finished product, it is a broken one — so the
 * three inserts either all land or none do.
 */
export async function createProduct(
  db: TxDb,
  fields: NewProductFields,
): Promise<{ ok: true; productId: string } | { ok: false; reason: CatalogFailure }> {
  try {
    const productId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(products)
        .values({
          slug: fields.slug,
          basePrice: fields.basePrice,
          categoryId: fields.categoryId,
          status: fields.status,
        })
        .returning({ id: products.id });

      const id = created!.id;

      await tx.insert(productTranslations).values({
        productId: id,
        locale: LOCALE,
        title: fields.title,
      });

      await tx.insert(productVariants).values({ productId: id, sku: fields.sku });

      return id;
    });

    return { ok: true, productId };
  } catch (error) {
    const failure = uniqueFailure(error);
    if (failure) return { ok: false, reason: failure };
    throw error;
  }
}

export interface ProductFields {
  slug: string;
  basePrice: Kopiykas;
  compareAtPrice: Kopiykas | null;
  dimensions: string | null;
  categoryId: string | null;
  status: ProductStatus;
  isFeatured: boolean;
  position: number;
  title: string;
  description: string | null;
  details: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

/** The «Основне» section: the product row and its Ukrainian text, together. */
export async function updateProduct(
  db: TxDb,
  productId: string,
  fields: ProductFields,
): Promise<CatalogResult> {
  return guarded(async () => {
    await db.transaction(async (tx) => {
      await tx
        .update(products)
        .set({
          slug: fields.slug,
          basePrice: fields.basePrice,
          compareAtPrice: fields.compareAtPrice,
          dimensions: fields.dimensions,
          categoryId: fields.categoryId,
          status: fields.status,
          isFeatured: fields.isFeatured,
          position: fields.position,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId));

      /*
       * Upsert, not update: `scripts/seed.ts` inserted translations with
       * `onConflictDoNothing`, so a product seeded before its translation
       * existed would otherwise have no row to update and the title would
       * silently refuse to save.
       */
      await tx
        .insert(productTranslations)
        .values({
          productId,
          locale: LOCALE,
          title: fields.title,
          description: fields.description,
          details: fields.details,
          metaTitle: fields.metaTitle,
          metaDescription: fields.metaDescription,
        })
        .onConflictDoUpdate({
          target: [productTranslations.productId, productTranslations.locale],
          set: {
            title: fields.title,
            description: fields.description,
            details: fields.details,
            metaTitle: fields.metaTitle,
            metaDescription: fields.metaDescription,
          },
        });
    });
  });
}

export interface VariantFields {
  sku: string;
  colorName: string | null;
  colorHex: string | null;
  priceOverride: Kopiykas | null;
  stock: number;
  position: number;
}

export async function addVariant(
  db: TxDb,
  productId: string,
  fields: VariantFields,
): Promise<CatalogResult> {
  return guarded(async () => {
    await db.insert(productVariants).values({ productId, ...fields });
  });
}

export async function updateVariant(
  db: TxDb,
  productId: string,
  variantId: string,
  fields: VariantFields,
): Promise<CatalogResult> {
  return guarded(async () => {
    await db
      .update(productVariants)
      .set({ ...fields, updatedAt: new Date() })
      // Scoped to the product too, so a variant id from another product's page
      // cannot be edited through this one.
      .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)));
  });
}

/**
 * Deactivating is the panel's «delete» for a variant, and it is the one variant
 * action with a consequence beyond its own row: `getProductBySlug` returns null
 * when a product has no active variants, so turning off the last one 404s a
 * published product without ever touching its status. That reads as the shop
 * breaking rather than as a choice somebody made, so it is refused.
 *
 * The count and the update share a transaction, and the lock is taken over
 * **every** variant of the product rather than over the siblings alone. Locking
 * only the others would let two tabs deactivating two different variants each
 * see one remaining and both be right, which is precisely the state this is
 * meant to prevent; taking the whole set makes the two serialise on the same
 * rows instead.
 */
export async function setVariantActive(
  db: TxDb,
  productId: string,
  variantId: string,
  active: boolean,
): Promise<CatalogResult> {
  return db.transaction(async (tx) => {
    const all = await tx
      .select({ id: productVariants.id, isActive: productVariants.isActive })
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .for('update');

    const activeOthers = all.filter((row) => row.isActive && row.id !== variantId);

    if (!active && activeOthers.length === 0) {
      return { ok: false, reason: 'last_active_variant' } satisfies CatalogResult;
    }

    const updated = await tx
      .update(productVariants)
      .set({ isActive: active, updatedAt: new Date() })
      .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)))
      .returning({ id: productVariants.id });

    if (updated.length === 0) return { ok: false, reason: 'not_found' } satisfies CatalogResult;
    return { ok: true } satisfies CatalogResult;
  });
}

/* --------------------------------------------------------------------images */

export interface NewImageFields {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  variantId: string | null;
}

/** Appends to the end of the gallery — position decides the lead image. */
export async function addProductImage(
  db: TxDb,
  productId: string,
  fields: NewImageFields,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ position: sql<number>`coalesce(max(${productImages.position}), -1)::int` })
      .from(productImages)
      .where(eq(productImages.productId, productId));

    await tx
      .insert(productImages)
      .values({ productId, ...fields, position: (last?.position ?? -1) + 1 });
  });
}

export async function updateProductImage(
  db: TxDb,
  productId: string,
  imageId: string,
  fields: { alt: string | null; variantId: string | null },
): Promise<CatalogResult> {
  const updated = await db
    .update(productImages)
    .set(fields)
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
    .returning({ id: productImages.id });

  return updated.length > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
}

/**
 * Moves one image one place, then **renumbers the whole gallery** 0…n-1.
 *
 * Swapping the two positions would be fewer statements and would not survive
 * the data: `product_images.position` has no unique constraint, the seed writes
 * it from manifest order, and ties are broken by `id` — so two images can share
 * a position and a swap between them would change nothing at all. Renumbering
 * makes the stored order match the rendered one every time, which also means the
 * `id` tiebreak stops mattering after the first move.
 */
export async function moveProductImage(
  db: TxDb,
  productId: string,
  imageId: string,
  direction: 'up' | 'down',
): Promise<CatalogResult> {
  return db.transaction(async (tx) => {
    const ordered = await tx
      .select({ id: productImages.id })
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(asc(productImages.position), asc(productImages.id))
      .for('update');

    const index = ordered.findIndex((image) => image.id === imageId);
    if (index === -1) return { ok: false, reason: 'not_found' } satisfies CatalogResult;

    const target = direction === 'up' ? index - 1 : index + 1;
    // Already at the end it is being asked to move towards: a no-op, not an
    // error — the button is simply not rendered there.
    if (target >= 0 && target < ordered.length) {
      [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    }

    for (const [position, image] of ordered.entries()) {
      await tx
        .update(productImages)
        .set({ position })
        .where(eq(productImages.id, image!.id));
    }

    return { ok: true } satisfies CatalogResult;
  });
}

/**
 * The one real delete in the catalog.
 *
 * Safe where archiving a product or variant would not be: nothing references an
 * image row, and the R2 object it points at is deliberately left in place —
 * object names are the hash of their bytes, so the same photo re-uploaded lands
 * on the same key, and deleting it here would break any other product row
 * pointing at the identical file.
 */
export async function removeProductImage(
  db: TxDb,
  productId: string,
  imageId: string,
): Promise<CatalogResult> {
  const removed = await db
    .delete(productImages)
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
    .returning({ id: productImages.id });

  return removed.length > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
}

/* ---------------------------------------------------------------- existence */

/** Cheap check that a product id names a real row, for the POST path. */
export async function productExists(db: Db | TxDb | Tx, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  return row !== undefined;
}
