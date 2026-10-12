import { MEDIA_URL_PREFIX, isMediaExtension, isMediaHash, mediaKeyFromUrl, objectKey } from './index';

// Same DOM-vs-Workers type bridge as `./serve.ts`.
type WorkersHeaders = Parameters<R2Object['writeHttpMetadata']>[0];

/**
 * Card-sized copies of product photos, for the grids and the small thumbnails.
 *
 * Photos are uploaded at full size (1440×1920 and up, ~300 KB) because the
 * product gallery shows them that large; a catalog card is ~300 CSS px wide,
 * so a phone was downloading a megabyte of pixels it threw away (PageSpeed,
 * 2026-10-12). Each photo gets one 640px WebP copy, made the first time it is
 * asked for and kept in R2 next to the original — so the Images binding runs
 * **once per photo, ever**, not per view. That is what keeps the 2026-08-03
 * decision's reason intact (roadmap: Cloudflare's free plan errors past 5 000
 * transformations a month): the catalog adds a few hundred, once. If a
 * transformation fails anyway, the original is served, briefly cached, and the
 * next request tries again — a card never loses its photo over this.
 */
export const CARD_WIDTH = 640;
const CARD_DIR = `w${CARD_WIDTH}`;

/** The card-sized URL for one of our photos; anything else comes back unchanged. */
export function cardImageUrl(url: string): string;
export function cardImageUrl(url: string | null): string | null;
export function cardImageUrl(url: string | null): string | null {
  if (!url || !mediaKeyFromUrl(url)) return url;
  return `${MEDIA_URL_PREFIX}${CARD_DIR}/${url.slice(MEDIA_URL_PREFIX.length)}`;
}

/** `w640/<hash>.<ext>` → the original's object key, or null when it is not one. */
export function cardSourceKey(key: string): string | null {
  const [dir, name, ...rest] = key.split('/');
  if (dir !== CARD_DIR || name === undefined || rest.length > 0) return null;
  const separator = name.lastIndexOf('.');
  if (separator === -1) return null;
  const hash = name.slice(0, separator);
  const extension = name.slice(separator + 1);
  if (!isMediaHash(hash) || !isMediaExtension(extension)) return null;
  return objectKey(hash, extension);
}

/** Where the copy lives in R2: its own prefix, so it can never collide with an upload. */
function cardObjectKey(sourceKey: string): string {
  return `${CARD_DIR}/${sourceKey.slice(0, sourceKey.lastIndexOf('.'))}.webp`;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

export async function serveCardImage(
  bucket: R2Bucket,
  images: ImagesBinding,
  key: string,
  requestHeaders: Headers,
): Promise<Response> {
  const sourceKey = cardSourceKey(key);
  if (!sourceKey) return notFound();
  const copyKey = cardObjectKey(sourceKey);

  const copy = await bucket.get(copyKey, { onlyIf: requestHeaders as unknown as WorkersHeaders });
  if (copy) {
    const headers = new Headers({ 'content-type': 'image/webp', 'cache-control': IMMUTABLE, etag: copy.httpEtag });
    if (!('body' in copy)) return new Response(null, { status: 304, headers });
    return new Response(copy.body as unknown as BodyInit, { headers });
  }

  const source = await bucket.get(sourceKey);
  if (!source) return notFound();
  const original = await source.arrayBuffer();

  try {
    const result = await images
      .input(new Response(original).body as unknown as Parameters<ImagesBinding['input']>[0])
      .transform({ width: CARD_WIDTH, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 80 });
    const bytes = await result.response().arrayBuffer();
    await bucket.put(copyKey, bytes, { httpMetadata: { contentType: 'image/webp', cacheControl: IMMUTABLE } });
    return new Response(bytes, { headers: { 'content-type': 'image/webp', 'cache-control': IMMUTABLE } });
  } catch (err) {
    console.error(`Card image for ${sourceKey} failed; serving the original`, err);
    const headers = new Headers();
    source.writeHttpMetadata(headers as unknown as WorkersHeaders);
    // Short, so the next visitor triggers another attempt.
    headers.set('cache-control', 'public, max-age=3600');
    return new Response(original, { headers });
  }
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=60' },
  });
}
