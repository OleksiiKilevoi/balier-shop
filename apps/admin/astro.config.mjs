// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Sourcemap upload to Sentry, token-gated — the full story of the gating and
// the map deletion is on the same block in `apps/site/astro.config.mjs`.
const sentryUpload = process.env.SENTRY_AUTH_TOKEN
  ? [
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        telemetry: false,
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        // A failed upload must warn, not fail the build — see apps/site.
        errorHandler: (err) => console.warn('[sentry-vite-plugin]', err.message),
      }),
    ]
  : [];

// https://astro.build/config
export default defineConfig({
  site: 'https://admin.balier.com.ua',
  output: 'server',
  // `cloudflare-binding` because the product editor's upload pipeline reads
  // image dimensions through the IMAGES binding (`@balier/lib/media`).
  adapter: cloudflare({
    imageService: 'cloudflare-binding',
  }),
  // Downloaded and self-hosted at build time — no runtime requests to Google.
  // Geist is the panel's only face; the storefront's Playfair and Inter live in
  // `apps/site/astro.config.mjs` and neither side ever loads the other's.
  // Weights are the three the panel actually paints: body, `font-medium`
  // labels and buttons, `font-semibold` headings. Nothing here is bold.
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Geist',
      cssVariable: '--font-geist',
      weights: [400, 500, 600],
      styles: ['normal'],
      subsets: ['cyrillic', 'latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
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
