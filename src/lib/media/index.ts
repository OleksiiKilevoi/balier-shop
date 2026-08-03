/**
 * Product photography: storage in R2, served by `src/pages/media/[...key].ts`.
 *
 * Images are prepared at the right size before they are uploaded, so this module
 * does not resize anything — one uploaded file is one stored object is one URL.
 * Nothing here calls the Images binding to transform, which means `/media/**`
 * cannot consume Cloudflare's monthly transformation allowance.
 */

/**
 * Object names are the first 16 hex chars of the SHA-256 of the file's bytes.
 * Two consequences:
 *
 *  - Objects are immutable, so `/media/**` ships `immutable` cache headers and a
 *    replaced photo can never be served stale — different bytes, different URL.
 *  - Re-uploading the same file is idempotent and costs no extra storage.
 *
 * 16 hex chars is 64 bits; for a catalog of thousands of photos the collision
 * probability is negligible, and a collision would mean identical bytes anyway.
 */
export const MEDIA_HASH_PATTERN = /^[0-9a-f]{16}$/;

const HASH_LENGTH = 16;

/** The formats we accept and serve. Anything else is rejected at upload. */
export const MEDIA_FORMATS = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  png: 'image/png',
} as const satisfies Record<string, string>;

export type MediaExtension = keyof typeof MEDIA_FORMATS;

export function isMediaExtension(value: string): value is MediaExtension {
  return Object.hasOwn(MEDIA_FORMATS, value);
}

export function isMediaHash(value: string): boolean {
  return MEDIA_HASH_PATTERN.test(value);
}

/**
 * Normalises a filename, bare extension or MIME type to a stored extension.
 * Returns null for anything not in `MEDIA_FORMATS`.
 */
export function toMediaExtension(source: string): MediaExtension | null {
  const value = source.toLowerCase().trim();

  for (const [extension, mime] of Object.entries(MEDIA_FORMATS)) {
    if (value === mime) return extension as MediaExtension;
  }

  const bare = (value.split('.').pop() ?? '').replace(/[^a-z0-9]/g, '');
  if (bare === 'jpeg') return 'jpg';
  return isMediaExtension(bare) ? bare : null;
}

export async function hashImage(bytes: ArrayBuffer): Promise<string> {
  // `crypto.subtle` is Web Crypto in both workerd and Node — no `node:crypto`.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, HASH_LENGTH);
}

/** R2 object name. */
export function objectKey(hash: string, extension: MediaExtension): string {
  return `${hash}.${extension}`;
}

/**
 * What goes in `product_images.url`, and straight into `src`.
 *
 * Deliberately site-relative: Phase 5 moves the store to the client's Cloudflare
 * account, and a relative path means not one database row has to be rewritten
 * when the bucket and the domain change underneath it.
 */
export function mediaUrl(hash: string, extension: MediaExtension): string {
  return `/media/${objectKey(hash, extension)}`;
}

/* ------------------------------------------------------------------ upload */

export interface MediaTarget {
  bucket: R2Bucket;
  /**
   * Used only for `info()` — reading intrinsic width and height so the markup
   * can reserve space and avoid layout shift. Never for transformation.
   */
  images: ImagesBinding;
}

export interface StoredImage {
  hash: string;
  extension: MediaExtension;
  /** Site-relative, ready for `product_images.url`. */
  url: string;
  width: number | null;
  height: number | null;
  /** True when these exact bytes were already in the bucket. */
  reused: boolean;
}

/**
 * Stores one prepared image. Shared by the dev ingest script and the admin
 * upload route (Phase 4), so the two cannot drift.
 */
export async function storeImage(
  { bucket, images }: MediaTarget,
  bytes: ArrayBuffer,
  source: string,
): Promise<StoredImage> {
  const extension = toMediaExtension(source);
  if (!extension) throw new Error(`Unsupported image format: ${source}`);

  const hash = await hashImage(bytes);
  const key = objectKey(hash, extension);

  const existing = await bucket.head(key);
  if (!existing) {
    await bucket.put(key, bytes, {
      httpMetadata: {
        contentType: MEDIA_FORMATS[extension],
        // Content-addressed, so the bytes behind this key can never change.
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }

  const { width, height } = await readDimensions(images, bytes);
  return { hash, extension, url: mediaUrl(hash, extension), width, height, reused: Boolean(existing) };
}

async function readDimensions(
  images: ImagesBinding,
  bytes: ArrayBuffer,
): Promise<{ width: number | null; height: number | null }> {
  try {
    const body = new Response(bytes).body;
    if (!body) return { width: null, height: null };

    const info = await images.info(body as ReadableStream<Uint8Array>);
    // SVG has no intrinsic pixel size, and the union reflects that.
    if ('width' in info) return { width: info.width, height: info.height };
  } catch {
    // Non-fatal: dimensions only prevent layout shift, they are not correctness.
  }
  return { width: null, height: null };
}
