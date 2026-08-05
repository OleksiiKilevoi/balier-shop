/// <reference types="../worker-configuration.d.ts" />

import type { Runtime } from '@astrojs/cloudflare';
import type { AdminSession } from '~/lib/auth';

declare global {
  /**
   * Secrets are never declared in `wrangler.jsonc`, so `wrangler types` cannot
   * see them. Declaration merging adds them to the generated `Env` interface,
   * which is what `import { env } from 'cloudflare:workers'` is typed against.
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
    /**
     * Signing key for the admin session cookie (`~/lib/auth/session.ts`).
     * Unlike the Cloudflare Access values this replaced, it **is** a real
     * credential: anyone holding it can mint a session for any admin. At least
     * 32 random bytes, different per environment, and rotating it signs
     * everyone out — which is also the only way to revoke a session early.
     * Unset means the gate denies every request.
     */
    ADMIN_SESSION_SECRET: string;
  }

  /** `Astro.locals.cfContext.waitUntil(...)` — see `docs/OVERVIEW.md`. */
  namespace App {
    interface Locals extends Runtime {
      /** Set by the admin gate for `/admin/**` and `/api/admin/**` only. */
      admin?: AdminSession;
    }
  }
}
