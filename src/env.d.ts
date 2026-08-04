/// <reference types="../worker-configuration.d.ts" />

import type { Runtime } from '@astrojs/cloudflare';
import type { AccessIdentity } from '~/lib/access';

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
     * Cloudflare Access, for the `/admin/**` gate in `src/middleware.ts`.
     * Neither is a credential — the gate's security is the JWT signature, not
     * the secrecy of these — but both are account-specific and do not exist
     * yet, so they are set per environment rather than committed to
     * `wrangler.jsonc`. Unset means the gate denies every request.
     */
    CF_ACCESS_TEAM_DOMAIN: string;
    CF_ACCESS_AUD: string;
  }

  /** `Astro.locals.cfContext.waitUntil(...)` — see `docs/OVERVIEW.md`. */
  namespace App {
    interface Locals extends Runtime {
      /** Set by the admin gate for `/admin/**` and `/api/admin/**` only. */
      admin?: AccessIdentity;
    }
  }
}
