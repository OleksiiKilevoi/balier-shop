/**
 * `pnpm cron:deploy` → this script. A bare `wrangler deploy` still works and
 * deploys correctly — what it loses is only Phase 3 of `docs/plans/sentry.md`:
 * without a SENTRY_RELEASE stamped and the maps uploaded under it, the cron's
 * Sentry stack traces stay minified. (The Astro apps don't need any of this —
 * their Vite builds match maps by injected debug IDs; a wrangler bundle has no
 * plugin hook, so it matches by release instead.)
 *
 * Steps:
 *   1. release = short git SHA (an uncommitted tree deploys under the SHA it
 *      grew from — close enough for a dev deploy, wrong only about the diff);
 *   2. `wrangler deploy --outdir dist --var SENTRY_RELEASE:<sha>` — the config's
 *      `upload_source_maps` makes it emit `dist/index.js.map` alongside;
 *   3. `sentry-cli sourcemaps upload --release=<sha> dist` — skipped with a
 *      warning when SENTRY_AUTH_TOKEN is not set, because the deploy itself
 *      must never be hostage to the error tracker.
 *
 * Credentials: SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT are read from
 * the environment, falling back to the repo root `.env` (gitignored, already
 * home to DATABASE_URL for drizzle-kit).
 *
 * `--dry-run` is passed through to wrangler (build only, no deploy) and skips
 * the upload — there is no release to attach maps to.
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');

// Minimal .env fallback: KEY=VALUE lines, no quoting rules — the three
// SENTRY_* values never need any.
for (const file of [resolve(import.meta.dirname, '../../.env')]) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const line of text.split('\n')) {
    const match = /^\s*(SENTRY_[A-Z_]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

// Joined strings through the shell (`pnpm` is `pnpm.cmd` on Windows); every
// argument is internal — flags and a git SHA — so there is nothing to escape.
const run = (command) => execSync(command, { stdio: 'inherit' });

const release = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();

run(
  `pnpm exec wrangler deploy${dryRun ? ' --dry-run' : ''} --outdir dist --var SENTRY_RELEASE:${release}`,
);

if (dryRun) {
  console.log(`[deploy.mjs] dry run: built dist/ for release ${release}, nothing deployed or uploaded.`);
} else if (!process.env.SENTRY_AUTH_TOKEN) {
  console.warn(
    `[deploy.mjs] SENTRY_AUTH_TOKEN not set — deployed release ${release} WITHOUT uploading ` +
      'sourcemaps; its Sentry stack traces will be minified. Token goes in the repo root .env.',
  );
} else {
  run(`pnpm exec sentry-cli sourcemaps upload --release=${release} dist`);
}
