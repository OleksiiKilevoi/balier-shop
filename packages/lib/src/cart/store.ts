import { persistentAtom } from '@nanostores/persistent';
import { computed } from 'nanostores';
import { mergeCartItems, type CartItem } from './index';
import { decodeCartItems } from './decode';
import { MAX_CART_LINES, MAX_ITEM_QUANTITY } from './limits';

/**
 * The browser's cart. Runs only in the browser — never import this from a page's
 * frontmatter, only from a `<script>`.
 *
 * It stores variant ids and quantities and nothing else. Prices, titles and
 * stock come from `/api/cart` every time the cart is displayed, so this store
 * cannot be edited into a discount: the worst a tampered `localStorage` entry
 * achieves is asking to buy something that is then priced by the server.
 *
 * `persistentAtom` also syncs across tabs through the `storage` event, so the
 * badge in a second tab follows an add made in the first.
 */

/** Namespaced so an unrelated key on the same origin can never be read as a cart. */
const STORAGE_KEY = 'balier:cart';

export const cartItems = persistentAtom<CartItem[]>(STORAGE_KEY, [], {
  encode: JSON.stringify,
  // Validated on the way out, not just on the way in: the value may have been
  // written by a previous version of this code, or by hand.
  decode: decodeCartItems,
});

/** Units across every line — the number on the header badge. */
export const cartCount = computed(cartItems, (items) =>
  items.reduce((count, item) => count + item.quantity, 0),
);

/**
 * Adds to an existing line rather than creating a second one, so a customer who
 * adds the same colour twice sees «2», not two rows.
 *
 * Silently ignores a new line past `MAX_CART_LINES`. That limit exists to bound
 * the validation query, and a shopper cannot reach it by hand; failing loudly
 * would mean an error dialog for a case that does not happen.
 */
export function addToCart(variantId: string, quantity = 1): void {
  const items = cartItems.get();
  const existing = items.find((item) => item.variantId === variantId);

  if (!existing && items.length >= MAX_CART_LINES) return;

  const next = clampQuantity((existing?.quantity ?? 0) + quantity);

  cartItems.set(
    existing
      ? items.map((item) => (item.variantId === variantId ? { ...item, quantity: next } : item))
      : [...items, { variantId, quantity: next }],
  );
}

/** Sets a line's quantity outright. Zero or less removes the line. */
export function setCartQuantity(variantId: string, quantity: number): void {
  if (quantity < 1) return removeFromCart(variantId);

  cartItems.set(
    cartItems
      .get()
      .map((item) =>
        item.variantId === variantId ? { ...item, quantity: clampQuantity(quantity) } : item,
      ),
  );
}

export function removeFromCart(variantId: string): void {
  cartItems.set(cartItems.get().filter((item) => item.variantId !== variantId));
}

export function clearCart(): void {
  cartItems.set([]);
}

/**
 * Overwrites the cart with what the server just said it is.
 *
 * Called after every `/api/cart` response so the stored cart — and therefore the
 * badge on every other page — converges on the truth instead of remembering
 * lines that have since sold out. Writes nothing when the two already agree, or
 * subscribers would re-render on every revalidation.
 */
export function replaceCart(items: readonly CartItem[]): void {
  const next = mergeCartItems(items);
  const current = cartItems.get();

  const identical =
    current.length === next.length &&
    current.every(
      (item, index) =>
        item.variantId === next[index]?.variantId && item.quantity === next[index]?.quantity,
    );

  if (!identical) cartItems.set(next);
}

function clampQuantity(quantity: number): number {
  return Math.min(Math.max(Math.round(quantity) || 1, 1), MAX_ITEM_QUANTITY);
}
