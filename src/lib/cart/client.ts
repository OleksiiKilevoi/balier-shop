import type { CartSummary } from '~/lib/cart';
import { cartItems } from '~/stores/cart';

/**
 * Validates the stored cart against `/api/cart`. Shared by every browser-side
 * consumer of the cart (the `/cart` page, the add-to-cart popup) so there is
 * one fetch, one error message and one reading of "what the server said".
 */
export async function fetchCartSummary(): Promise<CartSummary> {
  const response = await fetch('/api/cart', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: cartItems.get() }),
  });

  if (!response.ok) throw new Error(`cart validation failed: ${response.status}`);
  return (await response.json()) as CartSummary;
}
