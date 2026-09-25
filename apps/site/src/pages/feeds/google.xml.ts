import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '@balier/lib/db';
import { listFeedVariants } from '@balier/lib/db/queries/products';
import { googleFeed } from '@balier/lib/products/googleFeed';

export const prerender = false;

/**
 * The Merchant Center product feed, fetched by Google on a schedule. Rendered
 * per request from the live catalog like `/sitemap.xml`, cached an hour.
 */
export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? url).origin;
  const variants = await listFeedVariants(createDb(env.DATABASE_URL));
  return new Response(googleFeed(variants, origin), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
