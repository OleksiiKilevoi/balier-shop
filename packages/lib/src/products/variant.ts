/**
 * How a variant is named everywhere a person reads it — the cart, the order,
 * its e-mail and Telegram message, the panel: «Чорний · M», «M», «Чорний»,
 * or nothing for a product with one plain variant. The SQL in
 * `db/queries/cart.ts` builds the same string for the order snapshot.
 */
export function variantLabel(colorName: string | null, size: string | null): string | null {
  return [colorName, size].filter((part) => part && part.trim() !== '').join(' · ') || null;
}
