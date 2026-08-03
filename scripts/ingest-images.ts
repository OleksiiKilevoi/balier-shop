import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { storeImage, toMediaExtension } from '../src/lib/media';
import {
  MANIFEST_PATH,
  TEST_PRODUCTS,
  type MediaManifest,
  type ManifestEntry,
} from './test-catalog';

/**
 * Uploads the photography in `test-products` into R2 and writes the manifest
 * `seed.ts` reads.
 *
 * DEVELOPMENT SEEDING ONLY. It runs against the local R2 simulator via
 * `getPlatformProxy` — the same binding `astro dev` sees, persisted under
 * `.wrangler/state` — so it needs no Cloudflare login, which is what lets the
 * catalog be built before Phase 0 finishes. Nothing lands in the real bucket;
 * production imagery arrives through the admin upload route in Phase 4, which
 * calls the same `storeImage`.
 *
 * Idempotent: content-addressed keys mean re-running skips what already exists.
 */

async function main() {
  // Pinned to the local simulator even if a binding is later flagged
  // `experimental_remote` for the dev server's benefit.
  const { env, dispose } = await getPlatformProxy<Env>({ remoteBindings: false });

  console.log('Ingesting into local R2 (.wrangler/state)…');

  const manifest: MediaManifest = {};
  let uploaded = 0;
  let reused = 0;

  try {
    for (const product of TEST_PRODUCTS) {
      const dir = path.join('test-products', product.folder);
      const files = (await readdir(dir))
        .filter((file) => toMediaExtension(file) !== null)
        // `10.webp` must not sort before `2.webp`.
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

      if (files.length === 0) {
        console.warn(`  ${product.slug}: no images in ${dir}`);
        continue;
      }

      for (const file of files) {
        const bytes = await readFile(path.join(dir, file));
        const stored = await storeImage(
          { bucket: env.MEDIA, images: env.IMAGES },
          // A Buffer's ArrayBuffer may be a shared pool slab; slice to this view.
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          file,
        );

        const entry: ManifestEntry = {
          url: stored.url,
          width: stored.width,
          height: stored.height,
        };
        manifest[`${product.folder}/${file}`] = entry;

        if (stored.reused) reused += 1;
        else uploaded += 1;

        const size = `${Math.round(bytes.byteLength / 1024)} KB`;
        const dimensions = stored.width ? `${stored.width}x${stored.height}` : 'unknown size';
        console.log(
          `  ${product.slug}/${file} -> ${stored.url}  ${dimensions}, ${size}` +
            (stored.reused ? ' (already present)' : ''),
        );
      }
    }

    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`\n${uploaded} uploaded, ${reused} already present. Manifest: ${MANIFEST_PATH}`);
    console.log('Next: pnpm db:seed');
  } finally {
    await dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
