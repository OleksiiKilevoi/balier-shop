import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../index';
import { bundleUnitPrice, type BundleRule } from '../../cart/bundle';
import {
  productCompanions,
  productImages,
  productTranslations,
  productVariants,
  products,
} from '../schema';
import type { CartVariantData, CompanionOffer } from '../../cart';
import { LOCALE } from './locale';
import { VARIANT_NAME_SQL } from './variantName';

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
      variantName: VARIANT_NAME_SQL,
      variantHex: productVariants.colorHex,
      sku: productVariants.sku,
      unitPrice: sql<number>`coalesce(${productVariants.priceOverride}, ${products.basePrice})`,
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
      productId: row.productId,
      productSlug: row.productSlug,
      productTitle: row.productTitle,
      variantName: row.variantName,
      variantHex: row.variantHex,
      sku: row.sku,
      unitPrice: row.unitPrice,
      inStock: row.inStock,
      imageUrl: image?.url ?? null,
      imageAlt: image?.alt ?? null,
    };
  });
}

/**
 * The order-creation half of the same resolution, run inside the create-order
 * transaction so the price an order is written with is read in the same
 * transaction that writes it. No images — order items snapshot text and price,
 * never a photo.
 *
 * This took `FOR UPDATE` over the variant rows until 2026-08-10, so that two
 * checkouts for the same variant could not both read the same available count
 * and oversell it. With availability a flag that no order decrements, there is
 * no count to race for: two customers ordering the last bag is now the
 * accepted outcome (`~/lib/db/schema.ts`, `productVariants.inStock`), so the
 * lock was buying nothing and is gone.
 */
export async function findCheckoutVariants(
  tx: Tx,
  variantIds: readonly string[],
): Promise<CartVariantData[]> {
  if (variantIds.length === 0) return [];

  const rows = await tx
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productSlug: products.slug,
      productTitle: productTranslations.title,
      variantName: VARIANT_NAME_SQL,
      variantHex: productVariants.colorHex,
      sku: productVariants.sku,
      unitPrice: sql<number>`coalesce(${productVariants.priceOverride}, ${products.basePrice})`,
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
        inArray(productVariants.id, [...variantIds]),
        eq(productVariants.isActive, true),
        eq(products.status, 'active'),
      ),
    );

  return rows.map((row) => ({ ...row, imageUrl: null, imageAlt: null }));
}

/**
 * The bundle rules for the products in a cart: which companion each names, at
 * what percentage. Only companions that are themselves on sale count — a rule
 * pointing at an archived product prices nothing.
 */
export async function findBundleRules(
  db: Db | Tx,
  productIds: readonly string[],
): Promise<BundleRule[]> {
  if (productIds.length === 0) return [];
  const companion = alias(products, 'companion');
  return db
    .select({
      productId: productCompanions.productId,
      companionProductId: productCompanions.companionProductId,
      percent: products.companionDiscountPercent,
    })
    .from(productCompanions)
    .innerJoin(products, eq(products.id, productCompanions.productId))
    .innerJoin(companion, eq(companion.id, productCompanions.companionProductId))
    .where(and(inArray(productCompanions.productId, [...productIds]), eq(companion.status, 'active')));
}

/**
 * Every companion of one product that can be offered right now, in the order
 * the manager added them.
 * ponytail: one query per companion; a single join if lists ever grow long.
 */
export async function listCompanionOffers(
  db: Db,
  productId: string,
  percent: number,
): Promise<CompanionOffer[]> {
  const companions = await db
    .select({ id: productCompanions.companionProductId })
    .from(productCompanions)
    .where(eq(productCompanions.productId, productId))
    .orderBy(asc(productCompanions.createdAt));
  const offers = await Promise.all(
    companions.map((companion) => findCompanionOffer(db, companion.id, percent)),
  );
  return offers.filter((offer) => offer !== null);
}

/**
 * What to show for a companion product: its first in-stock active variant,
 * with the lead photo, priced both ways. A companion with nothing in stock is
 * not offered.
 */
export async function findCompanionOffer(
  db: Db,
  companionProductId: string,
  percent: number,
): Promise<CompanionOffer | null> {
  const [row] = await db
    .select({
      variantId: productVariants.id,
      productSlug: products.slug,
      productTitle: productTranslations.title,
      unitPrice: sql<number>`coalesce(${productVariants.priceOverride}, ${products.basePrice})`,
      imageUrl: sql<string | null>`(
        select ${productImages.url} from ${productImages}
        where ${productImages.productId} = ${products.id}
          and (${productImages.variantId} is null or ${productImages.variantId} = ${productVariants.id})
        order by ${productImages.position}, ${productImages.id} limit 1
      )`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
    )
    .where(
      and(
        eq(products.id, companionProductId),
        eq(products.status, 'active'),
        eq(productVariants.isActive, true),
        eq(productVariants.inStock, true),
      ),
    )
    .orderBy(asc(productVariants.position), asc(productVariants.sku))
    .limit(1);
  return row ? { ...row, bundleUnitPrice: bundleUnitPrice(row.unitPrice, percent) } : null;
}
