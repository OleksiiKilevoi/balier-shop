import { z } from 'zod';

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

/** Per line. Above this it is a wholesale order and a conversation, not a cart. */
export const MAX_ITEM_QUANTITY = 99;

/**
 * Distinct lines. The catalog is tens of products, so a cart longer than this is
 * a script rather than a shopper — and every line costs a row in the validation
 * query.
 */
export const MAX_CART_LINES = 30;

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

/** The same, starting from the raw JSON string the store persists. */
export function decodeCartItems(raw: string): CartItemInput[] {
  try {
    return parseCartItems(JSON.parse(raw));
  } catch {
    return [];
  }
}
