import { describe, expect, it } from 'vitest';
import { mediaKeyFromUrl, mediaUrl, objectKey } from './index';

/**
 * `mediaKeyFromUrl` turns a database string into a bucket lookup, which is why
 * it is tested for what it *refuses* at least as much as for what it resolves:
 * every rejection below is a row that must not become a probe of the bucket.
 */
describe('mediaKeyFromUrl', () => {
  const hash = '25791458f81c6d41';

  it('round-trips whatever `mediaUrl` produced', () => {
    for (const extension of ['webp', 'avif', 'jpg', 'png'] as const) {
      const url = mediaUrl(hash, extension);
      expect(mediaKeyFromUrl(url), url).toBe(objectKey(hash, extension));
    }
  });

  it('refuses anything that is not one of our object names', () => {
    const rejected = [
      '/media/', // no name at all
      '/media/photo.webp', // not a content hash
      `/media/${hash}`, // no extension
      `/media/${hash}.gif`, // an extension `/media/**` cannot serve
      `/media/${hash.slice(0, 8)}.webp`, // a hash of the wrong length
      `/media/${hash.toUpperCase()}.webp`, // hex is lowercase
      `/media/nested/${hash}.webp`, // a path, not a name
      `https://example.com/media/${hash}.webp`, // another host entirely
      `/uploads/${hash}.webp`, // another prefix
      '', // an empty row
    ];

    for (const url of rejected) {
      expect(mediaKeyFromUrl(url), url).toBeNull();
    }
  });

  it('refuses a traversal dressed up as a name', () => {
    expect(mediaKeyFromUrl('/media/../../secret.webp')).toBeNull();
    expect(mediaKeyFromUrl('/media/%2e%2e%2fsecret.webp')).toBeNull();
  });
});
