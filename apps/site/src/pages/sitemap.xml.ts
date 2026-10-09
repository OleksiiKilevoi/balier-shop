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
 *
 * Products also list their photos (`<image:image>`), so Google Images finds
 * every one without first rendering each gallery.
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

/** Media URLs are hashes today, but an `&` in a path must not break the file. */
const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? url).origin;
  const db = createDb(env.DATABASE_URL);
  const [categories, products] = await Promise.all([
    listActiveCategories(db),
    listSitemapProducts(db),
  ]);

  const entries: { path: string; lastmod?: Date; images?: string[] }[] = [
    ...STATIC_PATHS.map((path) => ({ path })),
    ...categories.map((category) => ({ path: `/products/category/${category.slug}` })),
    ...products.map((product) => ({
      path: `/products/${product.slug}`,
      lastmod: product.updatedAt,
      images: product.imageUrls,
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries
  .map(({ path, lastmod, images = [] }) => {
    const date = lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
    const photos = images
      .map((src) => `<image:image><image:loc>${escapeXml(new URL(src, origin).href)}</image:loc></image:image>`)
      .join('');
    return `  <url><loc>${origin}${path}</loc>${date}${photos}</url>`;
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
