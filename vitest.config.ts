import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Plain Vitest, not `getViteConfig` from `astro/config`.
 *
 * What is tested here is pure domain code in `src/lib/` — order totals, cart
 * validation, and (next) the Monobank signature check. None of it touches
 * `cloudflare:workers`, the database or the DOM, so pulling the Astro config and
 * its adapter into the test run would buy nothing and would make a unit test
 * depend on the deploy target. The `~/*` alias is the one thing that has to
 * match `tsconfig.json`.
 */
export default defineConfig({
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
