/**
 * The cart's size limits, kept apart from `../validation/cart` so the browser
 * code that only needs the numbers (the header badge, the cart store) does not
 * pull zod into every page.
 */

/** Per line. Above this it is a wholesale order and a conversation, not a cart. */
export const MAX_ITEM_QUANTITY = 99;

/**
 * Distinct lines. The catalog is tens of products, so a cart longer than this is
 * a script rather than a shopper — and every line costs a row in the validation
 * query.
 */
export const MAX_CART_LINES = 30;
