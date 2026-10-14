import { storeImage, toMediaExtension } from './index';
import type { MediaExtension, MediaTarget, StoredImage } from './index';

/**
 * What the admin upload form will accept, decided before anything is written to
 * R2.
 *
 * PIXELS ARE NOT CHECKED HERE, ON PURPOSE (2026-08-06).
 * This guard used to enforce a minimum short side, a maximum long side and
 * portrait-or-square, on the reasoning that nothing in this project resizes an
 * image so the storefront inherits whatever was exported. The first half of that
 * is still true; the conclusion was not. Every place a product photo is rendered
 * — `ProductCard`'s `aspect-square`, `ProductGallery`'s `aspect-3/4`, the cart,
 * the cart popup and the panel's own thumbnails — is a fixed-ratio box with
 * `object-cover`, so the frame is the layout and the file is only ever cropped
 * into it. A landscape photo could not break the grid; it could only be centre-
 * cropped, which is a photography decision and belongs to whoever picked the
 * photo, not to a validator.
 *
 * So what is left are the two rules that are about the *file* rather than the
 * picture: it has to be an image we can serve, and it has to be small enough to
 * send to a customer. Those are not recoverable by CSS, and nothing resizes, so
 * the byte cap stays.
 *
 * Pure on purpose — it takes numbers, not an `R2Bucket` — so the rules are
 * testable without a binding, and so the page can refuse a file before spending
 * a write.
 */

/**
 * The only hard bound left, and it is bandwidth, not layout: `object-cover`
 * crops a photo to fit but still downloads every byte of it. Tightened from
 * 5 MB (2026-08-06) because nothing resizes server-side yet, so whatever the
 * manager uploads is what every phone on `/products` downloads — this cap is
 * the interim substitute for real resizing. The largest seeded catalog file
 * (713 KB) still clears it.
 */
/**
 * The whole multipart body, not just the image: `formData()` buffers
 * everything before `MAX_UPLOAD_BYTES` can be applied to the file, so a
 * hundred-megabyte POST would be held in the Worker's memory first (audit,
 * 2026-09-22). Generous envelope — the image plus every text field of the
 * editor.
 */
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export const MAX_UPLOAD_BYTES = 1 * 1024 * 1024;

/**
 * The long edge photos are downscaled to before upload (`/products/[id]`), the
 * height `test-products/` was shot at — the shape that fills the catalog frame.
 */
export const EXPECTED_HEIGHT = 1920;

export type UploadIssue = 'empty' | 'too_large' | 'unreadable' | 'unsupported_format';

export interface UploadCandidate {
  /** Bytes on the wire. */
  size: number;
  /**
   * The MIME type the Images binding *decoded*, not the one the browser
   * declared. Those differ more often than they should — a `curl -F` upload
   * arrives as `application/octet-stream` and is still a perfectly good WebP —
   * and the decoded answer is the one that matches what will be served.
   *
   * `null` means the binding could not read it as an image at all, which is a
   * different answer from «a format we do not serve» and gets a different
   * sentence. Width and height are deliberately not asked for: they no longer
   * decide anything here, and are read only so the markup can reserve space.
   */
  format: string | null;
}

/**
 * `null` means the file is acceptable.
 *
 * The order matters: size first, because it is knowable without decoding, then
 * the format.
 */
export function checkUploadedImage({ size, format }: UploadCandidate): UploadIssue | null {
  if (size <= 0) return 'empty';
  if (size > MAX_UPLOAD_BYTES) return 'too_large';

  // The binding threw: a corrupt file, or something that is not a picture.
  if (format === null) return 'unreadable';
  // It decoded, but into something `/media/**` cannot serve — GIF, SVG, PDF.
  if (toMediaExtension(format) === null) return 'unsupported_format';

  return null;
}

/**
 * A form's file field, checked and stored: the whole upload path in one call.
 * `{ issue }` when it is refused, `{ image }` when it is in the bucket.
 */
export async function acceptUploadedImage(
  target: MediaTarget,
  file: FormDataEntryValue | null,
): Promise<{ issue: UploadIssue } | { image: StoredImage }> {
  if (!(file instanceof File) || file.size === 0) return { issue: 'empty' };
  const bytes = await file.arrayBuffer();

  // The *decoded* format, not the declared one — see `UploadCandidate.format`.
  let format: string | null = null;
  try {
    const body = new Response(bytes).body as unknown as Parameters<ImagesBinding['info']>[0];
    format = (await target.images.info(body)).format;
  } catch {
    // Left null; `checkUploadedImage` refuses on exactly that.
  }

  const issue = checkUploadedImage({ size: bytes.byteLength, format });
  if (issue) return { issue };
  return { image: await storeImage(target, bytes, format!) };
}
