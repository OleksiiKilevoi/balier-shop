import type { Kopiykas } from '../money';
import { applyBundles, type BundleRule } from './bundle';
import { MAX_CART_LINES, MAX_ITEM_QUANTITY, type CartItemInput } from '../validation/cart';

/**
 * The cart, as a pure function of "what the customer asked for" and "what the
 * database says".
 *
 * Nothing in this file touches the DB, the network or the DOM — which is the
 * point. `buildCartSummary` is the first half of the order-total calculation
 * that Phase 3's checkout finishes, and the roadmap names that as one of the two
 * places where a bug costs money, so it is unit tested (`index.test.ts`).
 *
 * The rule it exists to enforce: **quantities are intent, prices are not**. The
 * client may ask for three of something; how much three of them cost, and
 * whether three can be had at all, is decided here from database rows.
 */

export type CartItem = CartItemInput;

/** What the database knows about one variant sitting in someone's cart. */
export interface CartVariantData {
  variantId: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  /** NULL when the product has no colour choice — the line then shows no swatch. */
  variantName: string | null;
  variantHex: string | null;
  sku: string;
  /** Kopiykas, already resolved against `products.base_price`. */
  unitPrice: Kopiykas;
  /** The manager's availability flag. There is no quantity to compare against. */
  inStock: boolean;
  imageUrl: string | null;
  imageAlt: string | null;
}

export interface CartLine extends CartVariantData {
  quantity: number;
  /** Units priced at `bundleUnitPrice` because the main product is in the cart (`./bundle.ts`). */
  bundleUnits: number;
  bundleUnitPrice: Kopiykas;
  /** Kopiykas, computed here and never sent by the client. */
  lineTotal: Kopiykas;
}

/** A companion product the cart could still take at its bundle price. */
export interface CompanionOffer {
  variantId: string;
  productSlug: string;
  productTitle: string;
  imageUrl: string | null;
  unitPrice: Kopiykas;
  bundleUnitPrice: Kopiykas;
}

/**
 * Why a line the customer had is not the line they got back.
 *
 * - `unavailable` — the variant, or its product, is gone or no longer active.
 * - `out_of_stock` — it exists, but the shop has flagged it as not in stock.
 *
 * There used to be a third, `reduced` — "you asked for five, there are two" —
 * which died with the stock count on 2026-08-10: a flag has no number to clamp
 * a quantity against, so a line is either kept whole or dropped whole.
 */
export type CartNoticeReason = 'unavailable' | 'out_of_stock';

export interface CartNotice {
  variantId: string;
  reason: CartNoticeReason;
  /** NULL for a variant that no longer exists — we have no name to show. */
  title: string | null;
}

export interface CartSummary {
  lines: CartLine[];
  notices: CartNotice[];
  /** Kopiykas. */
  itemsTotal: Kopiykas;
  /**
   * Kopiykas, always 0.
   *
   * Open decision 1, decided 2026-08-03: Nova Poshta is paid by the recipient at
   * the carrier's own tariff, so the site never quotes a delivery price and
   * Monobank is only ever charged for goods. The field exists anyway because
   * `orders.delivery_total` does, and because a store that later negotiates free
   * delivery over some threshold needs somewhere to put it.
   */
  deliveryTotal: Kopiykas;
  /** Kopiykas. What the customer pays. */
  total: Kopiykas;
  /** Units, not lines — this is the number on the header badge. */
  itemCount: number;
  /** Filled by `/api/cart`; the pure summary has no catalog to look them up in. */
  offers: CompanionOffer[];
}

/**
 * Collapses repeated variant ids and clamps to the documented limits.
 *
 * The store already keeps one entry per variant, so a duplicate means either a
 * hand-edited cart or two tabs racing. Summing is the reading that loses
 * nothing.
 */
export function mergeCartItems(items: readonly CartItem[]): CartItem[] {
  const byVariant = new Map<string, number>();

  for (const item of items) {
    const total = (byVariant.get(item.variantId) ?? 0) + item.quantity;
    byVariant.set(item.variantId, Math.min(total, MAX_ITEM_QUANTITY));
  }

  return [...byVariant]
    .slice(0, MAX_CART_LINES)
    .map(([variantId, quantity]) => ({ variantId, quantity }));
}

/** A cart with nothing in it — the answer for an empty request, with no DB round trip. */
export function emptyCartSummary(): CartSummary {
  return { lines: [], notices: [], itemsTotal: 0, deliveryTotal: 0, total: 0, itemCount: 0, offers: [] };
}

/**
 * Resolves requested items against the variants the database actually returned.
 *
 * The order of `items` is preserved, so the cart page does not reshuffle itself
 * on every revalidation. A variant missing from `variants` was filtered out by
 * the query — archived product, deactivated variant, or an id that never
 * existed — and all three mean the same thing to the customer.
 */
export function buildCartSummary(
  items: readonly CartItem[],
  variants: readonly CartVariantData[],
  rules: readonly BundleRule[] = [],
): CartSummary {
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));

  const lines: CartLine[] = [];
  const notices: CartNotice[] = [];

  for (const item of items) {
    const variant = byId.get(item.variantId);

    if (!variant) {
      notices.push({ variantId: item.variantId, reason: 'unavailable', title: null });
      continue;
    }

    if (!variant.inStock) {
      notices.push({
        variantId: item.variantId,
        reason: 'out_of_stock',
        title: variant.productTitle,
      });
      continue;
    }

    // `mergeCartItems` has already clamped the quantity to `MAX_ITEM_QUANTITY`,
    // which is now the only ceiling there is.
    const quantity = item.quantity;

    lines.push({ ...variant, quantity, bundleUnits: 0, bundleUnitPrice: variant.unitPrice, lineTotal: 0 });
  }

  const priced = applyBundles(lines, rules);
  lines.forEach((line, index) => Object.assign(line, priced[index]));

  const itemsTotal = lines.reduce((total, line) => total + line.lineTotal, 0);
  const deliveryTotal = 0;

  return {
    lines,
    notices,
    itemsTotal,
    deliveryTotal,
    total: itemsTotal + deliveryTotal,
    itemCount: lines.reduce((count, line) => count + line.quantity, 0),
    offers: [],
  };
}
