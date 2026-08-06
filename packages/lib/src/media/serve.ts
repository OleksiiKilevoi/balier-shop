import { isMediaExtension, isMediaHash, objectKey } from './index';

// DOM's Headers/ReadableStream and the Workers ones are structurally
// incompatible at the type level only; at runtime they are the same objects.
// The casts below bridge that, nothing more.
type WorkersHeaders = Parameters<R2Object['writeHttpMetadata']>[0];

/**
 * Serves product imagery out of R2 — the shared body of each app's
 * `pages/media/[...key].ts` route. It lives here because image URLs are stored
 * root-relative (`/media/<hash>.<ext>`), so both the storefront and the admin
 * panel must serve them on their own origin.
 *
 * Deliberately dumb: images are prepared at the right size before upload, so
 * this is a byte pump with cache headers and never transforms anything. It
 * exists instead of pointing the browser at the bucket's public `r2.dev` URL,
 * which Cloudflare rate-limits and documents as unsuitable for production — and
 * it keeps image URLs on our own origin, so moving to the client's account in
 * Phase 5 changes nothing the database or the markup can see.
 *
 * Both parts of the name are validated against a closed set, so this route
 * cannot be used to enumerate the bucket or reach objects it does not own.
 */
export async function serveMedia(
  bucket: R2Bucket,
  key: string,
  requestHeaders: Headers,
): Promise<Response> {
  const [name, ...rest] = key.split('/');
  if (name === undefined || rest.length > 0) return notFound();

  const separator = name.lastIndexOf('.');
  if (separator === -1) return notFound();

  const hash = name.slice(0, separator);
  const extension = name.slice(separator + 1);
  if (!isMediaHash(hash) || !isMediaExtension(extension)) return notFound();

  const object = await bucket.get(objectKey(hash, extension), {
    onlyIf: requestHeaders as unknown as WorkersHeaders,
  });
  if (!object) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers as unknown as WorkersHeaders);
  headers.set('etag', object.httpEtag);
  // Keys are content hashes, so the bytes behind a URL can never change.
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  // A failed `onlyIf` precondition yields an R2Object with no body: the client
  // already holds these bytes.
  if (!('body' in object)) return new Response(null, { status: 304, headers });

  return new Response(object.body as unknown as BodyInit, { headers });
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Short, so a missing image heals quickly once it is uploaded.
      'cache-control': 'public, max-age=60',
    },
  });
}
