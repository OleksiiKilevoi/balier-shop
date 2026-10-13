import { MAX_CART_LINES, MAX_ITEM_QUANTITY } from './limits';

/**
 * Reads the cart the browser persisted — the same rule as `cartItemsSchema` in
 * `../validation/cart`, written out by hand because this runs on every page
 * (the header badge) and zod alone was 18 KB of it. `decode.test.ts` holds the
 * two to the same answers.
 *
 * Never throws: a cart that cannot be parsed degrades to an empty one, exactly
 * as before — throwing here would break every page that renders the badge.
 */

// zod's `z.uuid()`: RFC 9562 versions 1–8 plus the nil and max UUIDs.
const UUID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

export interface DecodedCartItem {
  variantId: string;
  quantity: number;
}

export function readCartItems(value: unknown): DecodedCartItem[] {
  if (!Array.isArray(value) || value.length > MAX_CART_LINES) return [];
  const items: DecodedCartItem[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return [];
    const { variantId, quantity } = entry as Record<string, unknown>;
    if (typeof variantId !== 'string' || !UUID.test(variantId)) return [];
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
      return [];
    }
    // Only the two fields, as zod's default `strip` would leave them.
    items.push({ variantId, quantity });
  }
  return items;
}

/** The same, starting from the raw JSON string the store persists. */
export function decodeCartItems(raw: string): DecodedCartItem[] {
  try {
    return readCartItems(JSON.parse(raw));
  } catch {
    return [];
  }
}
