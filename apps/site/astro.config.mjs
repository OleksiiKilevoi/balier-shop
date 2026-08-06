// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://balier.ua',
  output: 'server',
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
    plugins: [tailwindcss()],
    // `@balier/lib` ships raw TypeScript source (no build step); it must be
    // bundled and transformed, never externalized to Node resolution.
    ssr: { noExternal: ['@balier/lib'] },
  },
});
