import { describe, expect, it } from 'vitest';
import {
  MAX_LONG_SIDE,
  MAX_UPLOAD_BYTES,
  MIN_SHORT_SIDE,
  checkUploadedImage,
} from './upload';
import type { UploadCandidate } from './upload';

/**
 * The guard in front of the only path that writes to the media bucket.
 *
 * Worth testing on its own because the failure it prevents is silent: nothing
 * resizes an image anywhere in this project, so a file that gets past here is
 * served to customers exactly as uploaded, and a wrong bound shows up as a
 * broken-looking product grid rather than as an error.
 *
 * The numbers below were checked against the real catalog with the Images
 * binding: `test-products/1/2.webp` is 204 608 bytes, `image/webp`, 1440×1920.
 */

const GOOD: UploadCandidate = {
  size: 204_608,
  format: 'image/webp',
  width: 1440,
  height: 1920,
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
    expect(check({ size: 0, format: null, width: null, height: null })).toBe('empty');
  });

  it('refuses a file over the size cap', () => {
    expect(check({ size: MAX_UPLOAD_BYTES + 1 })).toBe('too_large');
    expect(check({ size: MAX_UPLOAD_BYTES })).toBeNull();
  });

  it('refuses a format the media module cannot serve', () => {
    for (const format of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain']) {
      expect(check({ format }), format).toBe('unsupported_format');
    }
  });

  it('refuses a file whose dimensions could not be read', () => {
    // A corrupt file: the binding throws, so the caller has no format and no
    // pixels — the format check catches it first.
    expect(check({ format: null, width: null, height: null })).toBe('unsupported_format');
    // An SVG: a format the binding *does* name, with no intrinsic pixel size.
    // `image/svg+xml` is not servable either, so that is what it is refused for.
    expect(check({ format: 'image/svg+xml', width: null, height: null })).toBe('unsupported_format');
    // And a servable format whose pixels still could not be read.
    expect(check({ width: null, height: null })).toBe('unreadable');
    expect(check({ format: 'image/png', width: 1440, height: null })).toBe('unreadable');
    expect(check({ format: 'image/png', width: 0, height: 0 })).toBe('unreadable');
  });

  it('refuses anything the grid would have to upscale', () => {
    expect(check({ width: MIN_SHORT_SIDE - 1, height: 1920 })).toBe('too_small');
    expect(check({ width: MIN_SHORT_SIDE, height: 1920 })).toBeNull();
    // The *short* side is what matters, whichever side that is.
    expect(check({ width: 400, height: 400 })).toBe('too_small');
  });

  it('refuses an unprepared camera original', () => {
    expect(check({ width: 3000, height: MAX_LONG_SIDE + 1 })).toBe('too_big');
    expect(check({ width: 3000, height: MAX_LONG_SIDE })).toBeNull();
  });

  it('refuses landscape but allows square', () => {
    expect(check({ width: 1920, height: 1440 })).toBe('landscape');
    expect(check({ width: 1440, height: 1440 })).toBeNull();
    expect(check({ width: 1439, height: 1440 })).toBeNull();
  });
});
