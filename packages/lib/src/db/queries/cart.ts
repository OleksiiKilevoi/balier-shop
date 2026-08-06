import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../index';
import { productImages, productTranslations, productVariants, products } from '../schema';
import type { CartVariantData } from '../../cart';
import { LOCALE } from './locale';
import { availableStock } from './stock';

/**
 * The authoritative half of the cart: everything the customer's variant ids
 * actually resolve to right now.
 *
 * Variants whose product is not `active`, or which are deactivated themselves,
 * are simply not returned — `buildCartSummary` reads a missing row as "no longer
 * available" and drops the line with a notice. That is the same rule the product
 * page applies, so a cart cannot outlive the page it was filled from.
 */
export async function findCartVariants(
  db: Db,
  variantIds: readonly string[],
): Promise<CartVariantData[]> {
  if (variantIds.length === 0) return [];

  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productSlug: products.slug,
      productTitle: productTranslations.title,
      variantName: productVariants.colorName,
      variantHex: productVariants.colorHex,
      sku: productVariants.sku,
      unitPrice: sql<number>`coalesce(${productVariants.priceOverride}, ${products.basePrice})`,
      available: availableStock(),
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
    )
    .where(
      and(
        inArray(productVariants.id, [...variantIds]),
        eq(productVariants.isActive, true),
        eq(products.status, 'active'),
      ),
    );

  if (rows.length === 0) return [];

  // A cart line shows the photo of the colour that was chosen, falling back to
  // the product's shared photography — the same precedence the gallery uses when
  // a variant is selected. Anything belonging to a *different* colour is left in
  // the database rather than fetched and discarded.
  const productIds = [...new Set(rows.map((row) => row.productId))];
  const images = await db
    .select({
      productId: productImages.productId,
      variantId: productImages.variantId,
      url: productImages.url,
      alt: productImages.alt,
    })
    .from(productImages)
    .where(
      and(
        inArray(productImages.productId, productIds),
        or(isNull(productImages.variantId), inArray(productImages.variantId, [...variantIds])),
      ),
    )
    .orderBy(asc(productImages.position), asc(productImages.id));

  return rows.map((row) => {
    const image =
      images.find((candidate) => candidate.variantId === row.variantId) ??
      images.find(
        (candidate) => candidate.productId === row.productId && candidate.variantId === null,
      );

    return {
      variantId: row.variantId,
      productSlug: row.productSlug,
      productTitle: row.productTitle,
      variantName: row.variantName,
      variantHex: row.variantHex,
      sku: row.sku,
      unitPrice: row.unitPrice,
      available: row.available,
      imageUrl: image?.url ?? null,
      imageAlt: image?.alt ?? null,
    };
  });
}

/**
 * The order-creation half of the same resolution, run inside the
 * create-order transaction: locks the requested variant rows with
 * `FOR UPDATE` so a second checkout for the same variant blocks until this
 * one commits (or rolls back) its reservation, rather than both reading the
 * same "available" number and overselling it. No images — order items
 * snapshot text and price, never a photo.
 */
export async function lockCheckoutVariants(
  tx: Tx,
  variantIds: readonly string[],
): Promise<CartVariantData[]> {
  if (variantIds.length === 0) return [];

  const rows = await tx
    .select({
      variantId: productVariants.id,
      productSlug: products.slug,
      productTitle: productTranslations.title,
      variantName: productVariants.colorName,
      variantHex: productVariants.colorHex,
      sku: productVariants.sku,
      unitPrice: sql<number>`coalesce(${productVariants.priceOverride}, ${products.basePrice})`,
      available: availableStock(),
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
    )
    .where(
      and(
        inArray(productVariants.id, [...variantIds]),
        eq(productVariants.isActive, true),
        eq(products.status, 'active'),
      ),
    )
    .for('update', { of: productVariants });

  return rows.map((row) => ({ ...row, imageUrl: null, imageAlt: null }));
}
