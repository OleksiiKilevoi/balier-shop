import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs in Node, not in workerd, so it cannot use
// `import { env } from 'cloudflare:workers'`. Locally, DATABASE_URL lives in
// `.dev.vars` (the file wrangler reads); `.env` is honoured as a fallback.
loadEnv({ path: '.dev.vars', quiet: true });
loadEnv({ quiet: true });

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/lib/src/db/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
  dbCredentials: {
    // Only needed by `db:migrate` / `db:studio`. `db:generate` works offline.
    url: process.env.DATABASE_URL ?? '',
  },
});
