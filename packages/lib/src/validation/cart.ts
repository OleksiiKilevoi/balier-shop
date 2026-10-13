import { z } from 'zod';
import { MAX_CART_LINES, MAX_ITEM_QUANTITY } from '../cart/limits';

export { MAX_CART_LINES, MAX_ITEM_QUANTITY };

/**
 * The shape of a cart, shared by the browser store, the `/api/cart` route and
 * (from the next task) checkout.
 *
 * A cart item is **only** a variant id and a quantity. It deliberately carries no
 * price, title or stock figure: everything a customer sees is resolved from the
 * database on the server, so a hand-edited `localStorage` entry can change what
 * someone intends to buy but never what it costs. See the money rule in
 * `docs/CONVENTIONS.md`.
 */

export const cartItemSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
});

export const cartItemsSchema = z.array(cartItemSchema).max(MAX_CART_LINES);

export const cartRequestSchema = z.object({
  items: cartItemsSchema,
});

export type CartItemInput = z.infer<typeof cartItemSchema>;

/**
 * Reads a cart out of untrusted input — `localStorage`, which the customer owns
 * and which may also hold a value written by an older version of this code.
 *
 * Never throws: a cart that cannot be parsed degrades to an empty one. Throwing
 * here would break every page that renders the header badge.
 */
export function parseCartItems(value: unknown): CartItemInput[] {
  const parsed = cartItemsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * The browser store's reader lives in `../cart/decode` — same rule, no zod — so
 * the header badge does not ship this module to every page.
 */
export { decodeCartItems } from '../cart/decode';
