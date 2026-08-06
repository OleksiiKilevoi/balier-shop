import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, checkUploadedImage } from './upload';
import type { UploadCandidate } from './upload';

/**
 * The guard in front of the only path that writes to the media bucket.
 *
 * It checks the file, not the picture: every render site crops into a fixed
 * ratio with `object-cover`, so no width, height or orientation can reach the
 * layout. What is left is «can we serve these bytes» and «are there too many of
 * them», and nothing resizes, so the second one is the customer's download.
 *
 * The numbers below were checked against the real catalog with the Images
 * binding: `test-products/1/2.webp` is 204 608 bytes, `image/webp`, 1440×1920.
 */

const GOOD: UploadCandidate = {
  size: 204_608,
  format: 'image/webp',
};

function check(overrides: Partial<UploadCandidate>) {
  return checkUploadedImage({ ...GOOD, ...overrides });
}

describe('checkUploadedImage', () => {
  it('accepts a real file from the seeded catalog', () => {
    expect(checkUploadedImage(GOOD)).toBeNull();
  });

  it('accepts every format the media module can serve', () => {
    for (const format of ['image/webp', 'image/avif', 'image/jpeg', 'image/png']) {
      expect(check({ format }), format).toBeNull();
    }
  });

  it('refuses an empty file before anything else', () => {
    expect(check({ size: 0 })).toBe('empty');
    // Even when everything else about it is wrong too.
    expect(check({ size: 0, format: null })).toBe('empty');
  });

  it('refuses a format the media module cannot serve', () => {
    for (const format of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain']) {
      expect(check({ format }), format).toBe('unsupported_format');
    }
  });

  it('refuses a file the binding could not read as an image at all', () => {
    // The binding throws on a corrupt file or a non-image, and the caller has
    // no format to report. Distinct from a format we simply do not serve — the
    // manager is told the file is broken rather than that it is the wrong kind.
    expect(check({ format: null })).toBe('unreadable');
  });

  /*
   * The three rules this guard used to have — a minimum short side, a maximum
   * long side, portrait-or-square — are gone, because `object-cover` inside a
   * fixed-ratio box makes all three invisible to the layout. Pixels are no
   * longer part of `UploadCandidate` at all, so the way to state that is to
   * hand the guard the dimensions it once refused and watch it not care.
   */
  it('accepts pixel sizes and orientations the old bounds refused', () => {
    const refusedBefore = [
      { width: 320, height: 480 }, // under the old 800 px minimum short side
      { width: 6_000, height: 8_000 }, // over the old 4 000 px maximum long side
      { width: 1_920, height: 1_080 }, // landscape, which the grid now crops
    ];

    for (const pixels of refusedBefore) {
      // Cast because the guard's input no longer *has* these fields; passing
      // them anyway is precisely the point of the assertion.
      expect(checkUploadedImage({ ...GOOD, ...pixels } as UploadCandidate)).toBeNull();
    }
  });

  it('still refuses on bytes, because nothing resizes what is served', () => {
    expect(check({ size: MAX_UPLOAD_BYTES + 1 })).toBe('too_large');
    expect(check({ size: MAX_UPLOAD_BYTES })).toBeNull();
  });
});
