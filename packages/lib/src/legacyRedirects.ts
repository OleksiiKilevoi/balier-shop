/**
 * Where the old balier.com.ua's URLs go. A different site lived on this
 * domain from 2019 to 2025 (a CMS with `/shop/<category>/<product>.html` and
 * `<page>.html`), and Google still holds a couple of hundred of its pages;
 * every one of them 404s on the new store, which the coverage report of
 * 2026-09-21 listed first. A 301 keeps whatever weight those URLs earned and
 * lands the visitor near what they were after: pages on their successors,
 * products and categories on the closest catalog category.
 *
 * Pure: the storefront middleware calls it with a pathname and redirects
 * when it answers. Anything it does not know stays an honest 404.
 */

/**
 * The old CMS served the same tree under a language prefix — Google still
 * holds `/ru/shop/sumki/zhenskie/...` alongside the bare `/shop/...` (found in
 * the index 2026-09-23, where the prefixed ones were 404ing while the bare
 * ones already redirected). The prefix is stripped before anything is matched,
 * so one rule covers both; the new site has no such prefix, so nothing of ours
 * can collide with it.
 */
const LANGUAGE_PREFIX = /^\/(ru|ua|uk|en)(?=\/|$)/;

const EXACT: Record<string, string> = {
  '/o-nas.html': '/about',
  '/dostavka.html': '/delivery',
  '/faq.html': '/delivery',
  '/publichnaya-oferta.html': '/offer',
  '/clauses.html': '/offer',
  '/feedback.html': '/contacts',
  '/obratnaya-svyaz.html': '/contacts',
  '/reviews.html': '/',
  '/photo.html': '/',
  '/news.html': '/',
  '/shop.html': '/products',
  '/search.html': '/products',
  '/registration.html': '/products',
  '/reminding.html': '/products',
};

/**
 * Our own renamed product slugs. The panel has no slug history: when a
 * manager edits a slug the old URL simply 404s, and Google may already hold
 * it (2026-10-21: the category page linked the old slug the day before the
 * rename, and the coverage report filed the 404). Add a line here per rename;
 * the row is removed once the old URL has been out of the index for a while.
 */
const RENAMED: Record<string, string> = {
  '/products/shkirianyi-chokhol-na-viiskovyi-kvytok': '/products/shkirianyi-chokhol-viiskovyi-kvytok',
};

/** Old category/product slugs → the new category, first match wins. */
const SHOP_CATEGORIES: readonly [RegExp, string][] = [
  [/ryukzak|dorozhn/, '/products/category/backpacks-travel'],
  [/portmone|koshel|kartkholder|finansy|klatch|zazhim/, '/products/category/wallets'],
  [/portfel|muzhsk/, '/products/category/mens-bags'],
  [/zhensk|sumk/, '/products/category/womens-bags'],
];

export function legacyRedirect(pathname: string): string | null {
  const renamed = RENAMED[pathname];
  if (renamed) return renamed;

  const bare = pathname.replace(LANGUAGE_PREFIX, '') || '/';
  // `/ru` and `/ru/` were the Russian front page.
  if (bare === '/') return bare === pathname ? null : '/';

  const exact = EXACT[bare];
  if (exact) return exact;
  if (bare.startsWith('/news/')) return '/';
  if (bare.startsWith('/shop/cart/')) return '/products';
  if (bare.startsWith('/shop/')) {
    const match = SHOP_CATEGORIES.find(([pattern]) => pattern.test(bare));
    return match ? match[1] : '/products';
  }
  return null;
}
