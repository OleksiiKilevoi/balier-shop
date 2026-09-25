// Declaration merging into the generated `Env` (same trick as the apps'
// `src/env.d.ts`, different reason): SENTRY_RELEASE is not in `wrangler.jsonc`
// `vars` — it is stamped per deploy by `deploy.mjs` via
// `--var SENTRY_RELEASE:<sha>` — so `wrangler types` cannot see it. Optional
// on purpose: a bare `wrangler deploy` leaves it unset and the Sentry options
// in `index.ts` must survive that.
interface Env {
  SENTRY_RELEASE?: string;
  /** monobank «Покупка частинами» — secrets, optional; see `@balier/lib/monoparts`. */
  MONO_PARTS_URL?: string;
  MONO_PARTS_STORE_ID?: string;
  MONO_PARTS_SECRET?: string;
}
