import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '@balier/lib/db';
import { listActiveCategories } from '@balier/lib/db/queries/categories';
import { listSitemapProducts } from '@balier/lib/db/queries/products';

export const prerender = false;

/**
 * Every indexable URL: the content pages, the catalog, each category, each
 * active product. Rendered per request from the same queries the pages use, so
 * a product published in the panel is in the sitemap on the next fetch — and
 * cached for an hour at the edge, since crawlers re-read it far less often than
 * that anyway. Pages that carry `noindex` (cart, checkout, search) are left out.
 *
 * `<lastmod>` on products only, from the last panel edit of the product or a
 * variant. The other pages carry none: they have no edit timestamp, and a wrong
 * or always-now lastmod is worse for a crawler than none.
 */
const STATIC_PATHS = [
  '/',
  '/products',
  '/about',
  '/vyrobnytstvo',
  '/care',
  '/delivery',
  '/returns',
  '/contacts',
  '/personalization',
  '/palette',
  '/corporate',
  '/offer',
  '/chastynamy',
  '/privacy',
];

export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? url).origin;
  const db = createDb(env.DATABASE_URL);
  const [categories, products] = await Promise.all([
    listActiveCategories(db),
    listSitemapProducts(db),
  ]);

  const entries: { path: string; lastmod?: Date }[] = [
    ...STATIC_PATHS.map((path) => ({ path })),
    ...categories.map((category) => ({ path: `/products/category/${category.slug}` })),
    ...products.map((product) => ({ path: `/products/${product.slug}`, lastmod: product.updatedAt })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(({ path, lastmod }) => {
    const date = lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
    return `  <url><loc>${origin}${path}</loc>${date}</url>`;
  })
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
