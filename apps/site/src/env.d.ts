/// <reference types="../worker-configuration.d.ts" />

import type { Runtime } from '@astrojs/cloudflare';

declare global {
  /**
   * Secrets are never declared in `wrangler.jsonc`, so `wrangler types` cannot
   * see them. Declaration merging adds them to the generated `Env` interface,
   * which is what `import { env } from 'cloudflare:workers'` is typed against.
   *
   * Anything added here must also be documented in `.dev.vars.example`.
   * This is the storefront Worker's set — the admin panel's secrets
   * (`ADMIN_SESSION_SECRET`) live in `apps/admin/src/env.d.ts`, and
   * `NOVAPOSHTA_API_KEY` is cron-only (`workers/cron`).
   */
  interface Env {
    DATABASE_URL: string;
    MONOBANK_TOKEN: string;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;
  }

  /**
   * monobank «Покупка частинами» (`@balier/lib/monoparts`), optional: all three
   * set or the option is off. On `Cloudflare.Env` because that is what
   * `cloudflare:workers`' `env` is typed as. Sandbox:
   * `https://u2-demo-ext.mono.st4g3.com`, store `test_store_with_confirm`,
   * secret from monobank's public docs.
   */
  namespace Cloudflare {
    interface Env {
      MONO_PARTS_URL?: string;
      MONO_PARTS_STORE_ID?: string;
      MONO_PARTS_SECRET?: string;
    }
  }

  /** `Astro.locals.cfContext.waitUntil(...)` — see `docs/OVERVIEW.md`. */
  namespace App {
    interface Locals extends Runtime {}
  }
}
