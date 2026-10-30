/**
 * Which photo represents each variant in the Merchant Center feed.
 *
 * Photos are uploaded against one variant row (or none, for the product as a
 * whole), while the product page shows every size of a colour the photos of
 * that colour. The feed must do the same, or a «Pro 16"» whose sister
 * «Neo 13"» holds the photos goes out with no image and Google disapproves it
 * (8 items on 2026-10-30). Order: the variant's own photo, a photo of the same
 * colour, the product-level photo, then any photo of the product.
 */
export interface FeedImageVariant {
  variantId: string;
  productId: string;
  colorName: string | null;
}

export interface FeedImageRow {
  productId: string;
  variantId: string | null;
  url: string;
}

/** Variant id → lead photo URL. Variants with no photo at all are absent. */
export function leadImages(
  variants: readonly FeedImageVariant[],
  images: readonly FeedImageRow[],
): Map<string, string> {
  const byVariant = new Map<string, string>();
  const byProduct = new Map<string, string>();
  const productLevel = new Map<string, string>();
  for (const image of images) {
    if (image.variantId && !byVariant.has(image.variantId)) byVariant.set(image.variantId, image.url);
    if (!image.variantId && !productLevel.has(image.productId)) productLevel.set(image.productId, image.url);
    if (!byProduct.has(image.productId)) byProduct.set(image.productId, image.url);
  }

  const byColour = new Map<string, string>();
  for (const variant of variants) {
    const own = byVariant.get(variant.variantId);
    if (own && variant.colorName) {
      const key = `${variant.productId}:${variant.colorName}`;
      if (!byColour.has(key)) byColour.set(key, own);
    }
  }

  const lead = new Map<string, string>();
  for (const variant of variants) {
    const url =
      byVariant.get(variant.variantId) ??
      (variant.colorName ? byColour.get(`${variant.productId}:${variant.colorName}`) : undefined) ??
      productLevel.get(variant.productId) ??
      byProduct.get(variant.productId);
    if (url) lead.set(variant.variantId, url);
  }
  return lead;
}
