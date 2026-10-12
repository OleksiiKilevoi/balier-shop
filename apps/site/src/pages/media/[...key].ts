import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveMedia } from '@balier/lib/media/serve';
import { serveCardImage } from '@balier/lib/media/card';

export const prerender = false;

/**
 * Product imagery out of R2, plus the card-sized copies. The whole story — why this exists instead of the
 * bucket's public URL, and why both Workers carry it — lives with the shared
 * body in `@balier/lib/media/serve`.
 */
export const GET: APIRoute = ({ params, request }) => {
  const key = params.key ?? '';
  // `w640/<hash>.<ext>`: the card-sized copy, see `@balier/lib/media/card`.
  return key.includes('/')
    ? serveCardImage(env.MEDIA, env.IMAGES, key, request.headers)
    : serveMedia(env.MEDIA, key, request.headers);
};
