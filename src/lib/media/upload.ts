import { toMediaExtension } from './index';
import type { MediaExtension } from './index';

/**
 * What the admin upload form will accept, decided before anything is written to
 * R2.
 *
 * Nothing in this project resizes an image — `storeImage`'s header says so, and
 * one uploaded file is one stored object is one URL. The storefront therefore
 * inherits whatever the uploader happened to export, which is exactly why the
 * roadmap's own wording for this item is *"the form has to state the expected
 * dimensions and reject anything wildly off"*.
 *
 * So these bounds are typo guards in the same spirit as the cash-on-delivery
 * limit's: they catch a screenshot, a thumbnail and a 12 MB camera original.
 * They are not art direction, and they cannot tell a good photo from a bad one.
 * The catalog is shot at 1440×1920 and the form says so.
 *
 * Pure on purpose — it takes numbers, not an `R2Bucket` — so the rules are
 * testable without a binding, and so the page can refuse a file before spending
 * a write.
 */

/** Roughly twice the largest file in the seeded catalog (713 KB). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Below this the grid has to upscale, which looks worse than a missing photo. */
export const MIN_SHORT_SIDE = 800;

/** Above this is an unprepared camera original, not an export. */
export const MAX_LONG_SIDE = 4_000;

/** What `test-products/` was shot and exported at; quoted to the manager as-is. */
export const EXPECTED_WIDTH = 1440;
export const EXPECTED_HEIGHT = 1920;

export type UploadIssue =
  | 'empty'
  | 'too_large'
  | 'unsupported_format'
  | 'unreadable'
  | 'too_small'
  | 'too_big'
  | 'landscape';

export interface UploadCandidate {
  /** Bytes on the wire. */
  size: number;
  /**
   * The MIME type the Images binding *decoded*, not the one the browser
   * declared. Those differ more often than they should — a `curl -F` upload
   * arrives as `application/octet-stream` and is still a perfectly good WebP —
   * and the decoded answer is the one that matches what will be served.
   */
  format: string | null;
  width: number | null;
  height: number | null;
}

/**
 * `null` means the file is acceptable.
 *
 * The order matters: size first, because it is knowable without decoding, then
 * the format, then the pixels.
 */
export function checkUploadedImage({ size, format, width, height }: UploadCandidate): UploadIssue | null {
  if (size <= 0) return 'empty';
  if (size > MAX_UPLOAD_BYTES) return 'too_large';

  if (format === null || toMediaExtension(format) === null) return 'unsupported_format';

  /*
   * Missing dimensions are a refusal here, not the shrug they are in
   * `readDimensions`. That function swallows its errors deliberately, because
   * for the ingest script width and height only prevent layout shift. Here they
   * are the *input to the checks below*, so accepting a file whose size cannot
   * be read would quietly disable the guard it is meant to feed. It is also what
   * a corrupt file and an SVG both look like from here: the binding throws on
   * the first and returns a format with no pixel size for the second.
   */
  if (width === null || height === null || width <= 0 || height <= 0) return 'unreadable';

  if (Math.min(width, height) < MIN_SHORT_SIDE) return 'too_small';
  if (Math.max(width, height) > MAX_LONG_SIDE) return 'too_big';

  /*
   * Portrait or square only. The product grid and the gallery are both built
   * around the catalog's 3:4 frame, and one landscape photo in a row does not
   * look like a different photo — it looks like the page is broken.
   */
  if (width > height) return 'landscape';

  return null;
}

/** The stored extension for an accepted candidate, from its decoded format. */
export function uploadExtension(format: string): MediaExtension | null {
  return toMediaExtension(format);
}
