import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveMedia } from '@balier/lib/media/serve';

export const prerender = false;

/**
 * Product imagery out of R2. The whole story — why this exists instead of the
 * bucket's public URL, and why both Workers carry it — lives with the shared
 * body in `@balier/lib/media/serve`.
 */
export const GET: APIRoute = ({ params, request }) =>
  serveMedia(env.MEDIA, params.key ?? '', request.headers);
