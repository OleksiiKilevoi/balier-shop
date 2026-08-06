import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { MEDIA_FORMATS, toMediaExtension } from '@balier/lib/media';
import { MANIFEST_PATH, type MediaManifest } from './test-catalog';

/**
 * Copies the locally ingested dev photography into the real `balier-media`
 * bucket, so the deployed Worker has something to serve.
 *
 * A one-off convenience for development, not a production path: real imagery is
 * uploaded through the admin panel in Phase 4. Needs `wrangler login`.
 *
 * Run `pnpm media:ingest` first — this reads the manifest that produces, so the
 * remote object names match exactly what is already in the database.
 */

const run = promisify(execFile);
const BUCKET = 'balier-media';

/**
 * Wrangler's own JS entrypoint, invoked with `node` directly. Going through
 * `pnpm exec` would need `shell: true`, and on Windows that concatenates
 * arguments instead of escaping them — which mangles any value containing a
 * space, such as the cache-control header.
 */
const WRANGLER = path.join(
  path.dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
  'bin',
  'wrangler.js',
);

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as MediaManifest;
  const entries = Object.entries(manifest);

  if (entries.length === 0) {
    console.error(`${MANIFEST_PATH} is empty. Run \`pnpm media:ingest\` first.`);
    process.exit(1);
  }

  console.log(`Pushing ${entries.length} object(s) to ${BUCKET}…`);

  for (const [source, entry] of entries) {
    // `/media/<hash>.<ext>` -> `<hash>.<ext>`
    const key = entry.url.replace(/^\/media\//, '');
    const extension = toMediaExtension(key);
    if (!extension) throw new Error(`Cannot derive a format from ${entry.url}`);

    const file = path.join('test-products', source);

    await run(process.execPath, [
      WRANGLER,
      'r2',
      'object',
      'put',
      `${BUCKET}/${key}`,
      '--file',
      file,
      '--content-type',
      MEDIA_FORMATS[extension],
      // The route sets this on every response anyway; storing it keeps the
      // object correct if it is ever served by anything else.
      '--cache-control',
      'public, max-age=31536000, immutable',
      '--remote',
    ]);

    console.log(`  ${source} -> ${key}`);
  }

  console.log('\nDone. The deployed Worker can serve these once it has the MEDIA binding.');
}

main().catch((error: NodeJS.ErrnoException & { stderr?: string }) => {
  console.error(error.stderr ?? error);
  process.exit(1);
});
