/// <reference types="../worker-configuration.d.ts" />

/**
 * Secrets are never declared in `wrangler.jsonc`, so `wrangler types` cannot see
 * them. Declaration merging adds them to the generated `Env` interface, which is
 * what `import { env } from 'cloudflare:workers'` is typed against.
 *
 * Anything added here must also be documented in `.dev.vars.example`.
 */
interface Env {
  DATABASE_URL: string;
  MONOBANK_TOKEN: string;
  NOVAPOSHTA_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}
