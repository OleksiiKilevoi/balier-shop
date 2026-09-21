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

/** Old category/product slugs → the new category, first match wins. */
const SHOP_CATEGORIES: readonly [RegExp, string][] = [
  [/ryukzak|dorozhn/, '/products/category/backpacks-travel'],
  [/portmone|koshel|kartkholder|finansy|klatch|zazhim/, '/products/category/wallets'],
  [/portfel|muzhsk/, '/products/category/mens-bags'],
  [/zhensk|sumk/, '/products/category/womens-bags'],
];

export function legacyRedirect(pathname: string): string | null {
  const exact = EXACT[pathname];
  if (exact) return exact;
  if (pathname.startsWith('/news/')) return '/';
  if (pathname.startsWith('/shop/cart/')) return '/products';
  if (pathname.startsWith('/shop/')) {
    const match = SHOP_CATEGORIES.find(([pattern]) => pattern.test(pathname));
    return match ? match[1] : '/products';
  }
  return null;
}
