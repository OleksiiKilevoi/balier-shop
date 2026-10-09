/**
 * The «Ще з категорії» picks: the `count` products that follow `selfSlug` in
 * the category's own order, wrapping round to the start.
 *
 * «Following» rather than «the first few»: with the first few, the top of
 * every category would collect all the sibling links and anything further
 * down would get none. Following, each product is linked from the ones just
 * before it, so every product in a category is reachable from its neighbours —
 * which is the whole point of the block for a crawler.
 */
export function followingInOrder<T extends { slug: string }>(
  items: readonly T[],
  selfSlug: string,
  count: number,
): T[] {
  const others = items.filter((item) => item.slug !== selfSlug);
  if (others.length <= count) return others;
  // Where self sat; a product missing from the list (hidden from search, say)
  // starts from the top.
  const start = Math.max(0, items.findIndex((item) => item.slug === selfSlug));
  const rotated = [...items.slice(start), ...items.slice(0, start)].filter((item) => item.slug !== selfSlug);
  return rotated.slice(0, count);
}
