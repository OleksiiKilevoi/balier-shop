import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveMedia } from '@balier/lib/media/serve';

export const prerender = false;

/**
 * Image previews for the editor pages. `product_images.url` is root-relative
 * (`/media/<hash>.<ext>`), so the admin origin has to serve the same objects
 * the storefront does — shared body in `@balier/lib/media/serve`, public in
 * the gate (`src/middleware.ts`) because the keys are content hashes and the
 * same bytes are public on the storefront anyway.
 */
export const GET: APIRoute = ({ params, request }) =>
  serveMedia(env.MEDIA, params.key ?? '', request.headers);
