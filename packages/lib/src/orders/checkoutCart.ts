import type { Kopiykas } from '../money';
import type { CartVariantData } from '../cart';
import type { CartItemInput } from '../validation/cart';

/**
 * The checkout half of "reprice against the database, never trust the
 * client" — `~/lib/cart` does the same resolution for `/cart`, but clamps and
 * keeps going, because a cart is allowed to be provisional. An order is not:
 * if resolving a single line would change what the customer asked for, the
 * whole checkout is refused so they see and confirm the real cart before any
 * money moves, rather than silently being charged for less than they thought
 * they were buying.
 */

export type CheckoutNoticeReason = 'unavailable' | 'out_of_stock' | 'reduced';

export interface CheckoutNotice {
  variantId: string;
  reason: CheckoutNoticeReason;
  /** NULL for a variant that no longer exists — there is no name to show. */
  title: string | null;
}

export interface CheckoutLine extends CartVariantData {
  quantity: number;
  /** Kopiykas. `unitPrice × quantity`. */
  lineTotal: Kopiykas;
}

export type CheckoutCartResult =
  | { ok: true; lines: CheckoutLine[]; itemsTotal: Kopiykas }
  | { ok: false; notices: CheckoutNotice[] };

/**
 * Resolves requested items against what the database currently says.
 *
 * Any line that cannot be filled exactly as asked — gone, sold out, or short
 * on stock — fails the whole result. `notices` is empty only when the cart
 * itself was empty, which the caller should reject before ever reaching here
 * (there is nothing to order).
 */
export function resolveCheckoutCart(
  items: readonly CartItemInput[],
  variants: readonly CartVariantData[],
): CheckoutCartResult {
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
  const notices: CheckoutNotice[] = [];
  const lines: CheckoutLine[] = [];

  for (const item of items) {
    const variant = byId.get(item.variantId);

    if (!variant) {
      notices.push({ variantId: item.variantId, reason: 'unavailable', title: null });
      continue;
    }

    if (variant.available <= 0) {
      notices.push({ variantId: item.variantId, reason: 'out_of_stock', title: variant.productTitle });
      continue;
    }

    if (item.quantity > variant.available) {
      notices.push({ variantId: item.variantId, reason: 'reduced', title: variant.productTitle });
      continue;
    }

    lines.push({ ...variant, quantity: item.quantity, lineTotal: variant.unitPrice * item.quantity });
  }

  if (notices.length > 0) return { ok: false, notices };

  const itemsTotal = lines.reduce((total, line) => total + line.lineTotal, 0);
  return { ok: true, lines, itemsTotal };
}
