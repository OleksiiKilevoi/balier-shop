import type { Kopiykas } from '~/lib/money';
import { MAX_CART_LINES, MAX_ITEM_QUANTITY, type CartItemInput } from '~/lib/validation/cart';

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
  productSlug: string;
  productTitle: string;
  /** NULL when the product has no colour choice — the line then shows no swatch. */
  variantName: string | null;
  variantHex: string | null;
  sku: string;
  /** Kopiykas, already resolved against `products.base_price`. */
  unitPrice: Kopiykas;
  /** `stock − unexpired reservations`, from the one definition in `queries/stock.ts`. */
  available: number;
  imageUrl: string | null;
  imageAlt: string | null;
}

export interface CartLine extends CartVariantData {
  quantity: number;
  /** Kopiykas. `unitPrice × quantity`, computed here and never sent by the client. */
  lineTotal: Kopiykas;
}

/**
 * Why a line the customer had is not the line they got back.
 *
 * - `unavailable` — the variant, or its product, is gone or no longer active.
 * - `out_of_stock` — it exists but nothing is available.
 * - `reduced` — more was asked for than is available; the quantity was clamped.
 */
export type CartNoticeReason = 'unavailable' | 'out_of_stock' | 'reduced';

export interface CartNotice {
  variantId: string;
  reason: CartNoticeReason;
  /** NULL for a variant that no longer exists — we have no name to show. */
  title: string | null;
  /** The quantity that survived. Only meaningful for `reduced`. */
  quantity: number;
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
  return { lines: [], notices: [], itemsTotal: 0, deliveryTotal: 0, total: 0, itemCount: 0 };
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
): CartSummary {
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));

  const lines: CartLine[] = [];
  const notices: CartNotice[] = [];

  for (const item of items) {
    const variant = byId.get(item.variantId);

    if (!variant) {
      notices.push({ variantId: item.variantId, reason: 'unavailable', title: null, quantity: 0 });
      continue;
    }

    if (variant.available <= 0) {
      notices.push({
        variantId: item.variantId,
        reason: 'out_of_stock',
        title: variant.productTitle,
        quantity: 0,
      });
      continue;
    }

    const quantity = Math.min(item.quantity, variant.available);

    if (quantity < item.quantity) {
      notices.push({
        variantId: item.variantId,
        reason: 'reduced',
        title: variant.productTitle,
        quantity,
      });
    }

    lines.push({ ...variant, quantity, lineTotal: variant.unitPrice * quantity });
  }

  const itemsTotal = lines.reduce((total, line) => total + line.lineTotal, 0);
  const deliveryTotal = 0;

  return {
    lines,
    notices,
    itemsTotal,
    deliveryTotal,
    total: itemsTotal + deliveryTotal,
    itemCount: lines.reduce((count, line) => count + line.quantity, 0),
  };
}
