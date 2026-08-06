// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://admin.balier.mlosko.dev',
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
    plugins: [tailwindcss()],
    // `@balier/lib` ships raw TypeScript source (no build step); it must be
    // bundled and transformed, never externalized to Node resolution.
    ssr: { noExternal: ['@balier/lib'] },
  },
});
