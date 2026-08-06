/// <reference types="../worker-configuration.d.ts" />

import type { Runtime } from '@astrojs/cloudflare';
import type { AdminSession } from '@balier/lib/auth';
import type { AdminUserRecord } from '@balier/lib/db/queries/adminUsers';

declare global {
  /**
   * Secrets are never declared in `wrangler.jsonc`, so `wrangler types` cannot
   * see them. Declaration merging adds them to the generated `Env` interface,
   * which is what `import { env } from 'cloudflare:workers'` is typed against.
   *
   * Anything added here must also be documented in `.dev.vars.example`.
   * This is the admin Worker's set — the storefront's Turnstile secret stays
   * in `apps/site/src/env.d.ts`, and `NOVAPOSHTA_API_KEY` is cron-only.
   */
  interface Env {
    DATABASE_URL: string;
    MONOBANK_TOKEN: string;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;
    /**
     * Signing key for the admin session cookie (`@balier/lib/auth`). It IS a
     * real credential: anyone holding it can mint a session for any admin. At
     * least 32 random bytes, different per environment, and rotating it signs
     * everyone out — which is also the only way to revoke a session early.
     * Unset means the gate denies every request.
     */
    ADMIN_SESSION_SECRET: string;
  }

  /** `Astro.locals.cfContext.waitUntil(...)` — see `docs/OVERVIEW.md`. */
  namespace App {
    interface Locals extends Runtime {
      /** Set by the gate for every route except `/login`, `/logout`, `/media/**`. */
      admin?: AdminSession;
      /**
       * The live `admin_users` row behind that session, read by the gate on
       * every request it lets through — so a page needing the role or the
       * password hash uses this rather than querying again. Present exactly
       * when `admin` is.
       */
      adminUser?: AdminUserRecord;
    }
  }
}
