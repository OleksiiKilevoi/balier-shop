import { defineConfig } from 'vitest/config';

/**
 * Plain Vitest, not `getViteConfig` from `astro/config`.
 *
 * What is tested here is pure domain code — order totals, cart validation, the
 * Monobank signature check. None of it touches `cloudflare:workers`, the
 * database or the DOM, so pulling an Astro config and its adapter into the
 * test run would buy nothing and would make a unit test depend on the deploy
 * target. All imports inside the package are relative, so no alias is needed.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
