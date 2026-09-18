import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '@balier/lib/db';
import { listActiveCategories } from '@balier/lib/db/queries/categories';
import { listActiveProducts } from '@balier/lib/db/queries/products';

export const prerender = false;

/**
 * Every indexable URL: the content pages, the catalog, each category, each
 * active product. Rendered per request from the same queries the pages use, so
 * a product published in the panel is in the sitemap on the next fetch — and
 * cached for an hour at the edge, since crawlers re-read it far less often than
 * that anyway. Pages that carry `noindex` (cart, checkout, search) are left out.
 *
 * No `<lastmod>`: the card queries do not carry a timestamp, and a wrong or
 * always-now lastmod is worse for a crawler than none.
 */
const STATIC_PATHS = [
  '/',
  '/products',
  '/about',
  '/care',
  '/delivery',
  '/returns',
  '/contacts',
  '/personalization',
  '/palette',
  '/offer',
  '/privacy',
];

export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? url).origin;
  const db = createDb(env.DATABASE_URL);
  const [categories, products] = await Promise.all([
    listActiveCategories(db),
    listActiveProducts(db),
  ]);

  const paths = [
    ...STATIC_PATHS,
    ...categories.map((category) => `/products/category/${category.slug}`),
    ...products.map((product) => `/products/${product.slug}`),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
