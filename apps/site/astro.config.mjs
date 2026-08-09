// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

/**
 * Sourcemap upload to Sentry (`docs/plans/sentry.md` Phase 3). Gated on the
 * auth token, which exists only in the Workers Builds build environment (and
 * a developer's own shell if they set it): without it this build is exactly
 * what it was before Sentry — no sourcemaps generated, nothing uploaded,
 * nothing to delete. `hidden` keeps the `sourceMappingURL` comment out of the
 * bundles; `filesToDeleteAfterUpload` keeps the maps themselves out of the
 * deploy — client maps would otherwise ship as public static assets.
 */
const sentryUpload = process.env.SENTRY_AUTH_TOKEN
  ? [
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        telemetry: false,
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        // A failed upload must warn, not fail the build: this runs inside the
        // Workers Builds deploy, and shipping the store beats readable traces.
        errorHandler: (err) => console.warn('[sentry-vite-plugin]', err.message),
      }),
    ]
  : [];

// https://astro.build/config
export default defineConfig({
  site: 'https://balier.ua',
  output: 'server',
  // Prerendered pages are emitted as `about.html`, not `about/index.html`.
  // Cloudflare's asset server (`html_handling: auto-trailing-slash`, the default
  // the adapter deploys with) serves `about.html` at `/about` with a 200, but
  // answers `/about` with a 307 to `/about/` when the file is `about/index.html`.
  // Every link to these pages — the header nav, the whole footer — is written
  // without the slash, so the directory form put a redirect in front of all of
  // them. Only affects the seven prerendered content pages; SSR routing is
  // unchanged.
  build: { format: 'file' },
  // `passthrough`: no page uses `astro:assets` images (only `Font`), so the
  // IMAGES binding stayed with the admin app, whose upload pipeline is its one
  // real consumer.
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  // Fonts are downloaded and self-hosted at build time — no runtime requests to
  // Google. Cyrillic subsets are mandatory; the whole site is Ukrainian.
  //
  // The variables are named after the typeface, not the role: `--font-display`
  // and `--font-sans` are Tailwind theme keys, declared in `global.css` as
  // aliases of these. Injecting the family straight into a theme key looks like
  // it works but does not — Tailwind never sees a variable created at runtime,
  // so `font-display` compiles to nothing, and its own default `--font-sans`
  // silently overrides ours.
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Playfair Display',
      cssVariable: '--font-playfair',
      // Every display use in the design is bold (headings, logo, footer titles),
      // and none are italic. Without pinning `weights`/`styles`, Astro ships and
      // preloads faces that are never painted.
      weights: [700],
      styles: ['normal'],
      subsets: ['cyrillic', 'latin'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-inter',
      weights: [400, 500, 600],
      styles: ['normal'],
      subsets: ['cyrillic', 'latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    // Geist lives in `apps/admin/astro.config.mjs` — the panel's only face,
    // never loaded here, just as the storefront's two never load there.
  ],
  vite: {
    // Sentry's plugin goes after all others (its own requirement).
    plugins: [tailwindcss(), ...sentryUpload],
    build: { sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false },
    // `@balier/lib` ships raw TypeScript source (no build step); it must be
    // bundled and transformed, never externalized to Node resolution.
    ssr: { noExternal: ['@balier/lib'] },
  },
});
