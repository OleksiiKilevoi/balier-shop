# PLAN — Sentry error tracking

## Goal

Every server-side error across all three Workers (site, admin, cron) lands in Sentry with a
readable stack trace and request context — both unhandled exceptions and the errors we
deliberately catch-and-continue. No behaviour change: Sentry observes errors, never swallows
them. Telegram alerts and Workers Logs (`observability: enabled`) stay as they are; Sentry adds
aggregation and stack traces on top, it replaces nothing.

SDK: **`@sentry/cloudflare`** (not `@sentry/node` — doesn't run on Workers, and not
`@sentry/astro` — its server half is Node-only). It is designed around per-request wrapping with
options built from `env`, which matches hard rule 4 (no module-scope state) exactly.
`nodejs_compat` is already set in all three `wrangler.jsonc` files, which provides the
AsyncLocalStorage the SDK needs — no compat changes required.

Config: `SENTRY_DSN` in `vars` of each of the three `wrangler.jsonc` files (a DSN is a public
project identifier, not a secret). `environment: 'development'` until launch; at Phase 5 only
the tag flips to `'production'`. **Decided 2026-08-09: Sentry is NOT on the Phase 5
account-swap list** — unlike Neon/Cloudflare/Monobank it stays ours after release. Projects
live in the existing org we were invited into (not a fresh account). **One project `balier`
for all three Workers** (decided 2026-08-09 over site/admin/cron split): one DSN, one alert
setup, and a shared-lib bug groups into one issue instead of three. The Workers are told apart
by a tag — each wrapper sets `initialScope: { tags: { worker: 'site' | 'admin' | 'cron' } }`.
The project is attached to our own team so default alert rules notify nobody else; org event
quota is shared, so the DSN key gets a rate limit as a guard against a looping error starving
the org's other projects (accepted trade-off of the single project: that limit is shared, a
spammy cron can crowd out site events within it).

## Phases

### Phase 1 — the safety net: wrappers [done 2026-08-09]

Three wrap points cover every unhandled error in the codebase (~30 lines total).
`pnpm add @sentry/cloudflare` in `apps/site`, `apps/admin`, `workers/cron` (installed: 10.69.0).

- [x] `apps/site/src/middleware.ts` — `Sentry.wrapRequestHandler` as the **first** middleware in
      the `sequence`, passing `context.locals.cfContext` as the ExecutionContext (the SDK
      flushes via `waitUntil`; the adapter exposes it as `cfContext`, not `runtime.ctx`).
      Covers all pages + all 6 API routes.
- [x] `apps/admin/src/middleware.ts` — same wrapper, sequenced **ahead of the gate** so the
      no-session routes (`/login`, `/telegram/webhook`) are covered too.
- [x] `workers/cron/index.ts` — `Sentry.withSentry((env) => ({ dsn: env.SENTRY_DSN, … }), handler)`
      around the default export. **The jobs moved from `ctx.waitUntil(...)` to `await` inside
      `scheduled`** — a rejection inside a waitUntil promise never reaches the wrapper (or the
      invocation's own failure status); lifetime is identical, only the error path moved. The
      */15 trigger runs its two jobs via `Promise.allSettled` and rethrows the first rejection,
      so one job's failure neither cancels nor hides the other.
- [x] `SENTRY_DSN` + `SENTRY_ENVIRONMENT` in the three `wrangler.jsonc` `vars` blocks
      (+ `pnpm cf-typegen` regenerated the `Env` types).

**Notes/decisions:** `tracesSampleRate: 0` — errors only, no performance tracing for now.
The wrapper is catch-report-**rethrow**: the user still gets their 500, nothing is silenced.
Verified 2026-08-09 against `pnpm dev` with a temporary throwing route (removed after): SDK
logged `Captured error event`, the 500 still surfaced, and the DSN's ingest endpoint accepts
events (HTTP 200 + event id). Gate green. Not yet committed/deployed.

### Phase 2 — manual captures in swallowed catches [done 2026-08-09]

The wrappers only see errors that *reach* them. These sites deliberately catch-and-continue, so
each needs one line: `Sentry.captureException(err)` inside the existing `catch`, or
`Sentry.captureMessage(…)` where there is no exception, just a business anomaly currently logged
with `console.error`/`warn`. Thanks to AsyncLocalStorage, a capture called from deep inside
`packages/lib` attaches to the right request automatically — nothing needs threading through.

**Money / payments (most important):**

- [x] `reconcileAwaitingPayment` — `workers/cron/index.ts:159` — Monobank unreachable, invoice
      not reconciled (captureException)
- [x] `reconcileAwaitingPayment` — `workers/cron/index.ts:151` — payment landed on a cancelled
      order, manual refund owed (captureMessage)
- [x] Monobank webhook `POST` — `apps/site/src/pages/api/webhooks/monobank.ts:68` — same case
      via webhook (captureMessage)
- [x] `createOrder` compensation — `packages/lib/src/orders/create.ts:293` — order rolled back
      but the Monobank invoice couldn't be removed: a live payment link is left dangling
      (captureException)
- [x] `updateOrderStatus` — `packages/lib/src/orders/updateStatus.ts:181` — same dangling-invoice
      case on admin cancellation (captureException)

**Delivery / Nova Poshta:**

- [x] `trackWaybillStatuses` — `workers/cron/index.ts:232` — carrier status failed to apply to an
      order (captureException)
- [x] `trackWaybillStatuses` — `workers/cron/index.ts:211` — unknown NP status code
      (captureMessage)
- [x] `syncNovaPoshtaReferenceData` — `packages/lib/src/novaposhta/sync.ts:366` — sync anomaly
      (captureMessage)
- [x] waybill compensation — `apps/admin/src/pages/orders/[orderNumber].astro:179` — TTN created
      at NP but not recorded in DB and not deleted: orphaned waybill (captureException)
- [x] register compensation — `apps/admin/src/pages/registers/index.astro:99` — same for a
      registry sheet (captureException)

**Notifications (silent failures):**

- [x] `createEmailNotifier` → `orderPaid` — `packages/lib/src/notify/email.ts:97` — customer
      email didn't send (captureException)
- [x] `sendTelegramMessage` — `packages/lib/src/notify/telegram.ts:100, 106` —
      **Telegram sends themselves failed**; Telegram is our alert channel *and*, since
      `792dc66`, the delivery channel for admin OTP login codes — when it is down Sentry is the
      only place that shows it (captureException)

**Admin OTP login via Telegram (`792dc66`):**

- [x] OTP dispatch — `apps/admin/src/pages/login/telegram.astro:140` — the
      `issueOtp` + `sendTelegramMessage` chain runs off the response path with a bare
      `.catch(() => {})`: on failure the operator sees «надіслано», no code ever arrives, and
      today nothing is logged anywhere. The single most valuable capture in the feature —
      `.catch((err) => Sentry.captureException(err))`
- [x] `recordAdminLogin` bookkeeping — `apps/admin/src/pages/login/telegram.astro:192` — same
      bare `.catch(() => {})`; deliberately best-effort, but a silently failing DB write is
      still worth one line (captureException, low priority)
- [x] *No capture needed* in `apps/admin/src/pages/telegram/webhook.ts` or
      `packages/lib/src/db/queries/adminTelegram.ts`: the webhook deliberately lets a thrown
      query escape as a 500 (Telegram retries), so the Phase 1 wrapper sees it — the route is
      on the auth gate's allowlist, but the Sentry middleware runs regardless; the webhook's
      best-effort reply goes through `sendTelegramMessage`, covered above

**Storefront SSR:**

- [x] settlement suggestions fallback — `apps/site/src/pages/checkout.astro:41` — server-side
      catch, same SDK as the rest (captureException)

**Notes/decisions (build 2026-08-09):** all 15 sites landed exactly as listed; the two
sites with no exception object (`sendTelegramMessage`'s non-ok response, the webhook/cron
refund cases) use `captureMessage(…, 'error'|'warning')`. 334 lib tests pass with the SDK
imported — an uninitialised client makes every capture a no-op, so tests need no mocking.
Not driven live (that would mean forcing Monobank/NP/Telegram failures); the transport and
context plumbing are what Phase 1's smoke test already proved. `packages/lib` gains a direct
`@sentry/cloudflare` dependency. The cleaner
alternative — an `onError` callback threaded through the existing factories à la `ports.ts` —
costs more code for no behaviour difference; revisit only if the lib dependency starts to hurt
(e.g. tests, or reuse outside Workers).

### Phase 3 — readable stack traces: sourcemaps [built 2026-08-09; upload awaits the token]

- [x] `@sentry/vite-plugin` in both `astro.config.mjs` files: token-gated (without
      `SENTRY_AUTH_TOKEN` the build is exactly the pre-Sentry build — no maps, nothing
      uploaded), `sourcemap: 'hidden'`, maps deleted after upload so client maps never ship as
      public assets, and `errorHandler` demotes a failed upload to a warning — shipping the
      store beats readable traces, verified with a deliberately invalid token (upload 401s,
      build still green, no `.map` left in `dist`).
- [x] Cron: wrangler has no Vite, so `deploy.mjs` (now behind `pnpm cron:deploy`) does the
      release-based flow instead — `wrangler deploy --outdir dist --var SENTRY_RELEASE:<sha>`
      (`upload_source_maps: true` in `wrangler.jsonc` makes wrangler emit the map, and lets
      Cloudflare deminify its own Workers Logs too), then `sentry-cli sourcemaps upload
      --release=<sha> dist`, skipped with a warning when the token is absent. The SDK options
      carry `release: env.SENTRY_RELEASE` (optional — a bare `wrangler deploy` still works,
      just minified). Driven with `--dry-run`: bundle + map emitted, release stamped.

**Notes/decisions:** optional quality-of-life; Phase 1+2 are useful without it, stack traces are
just minified. Credentials come from env: `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`
(project slug is `balier`; org slug visible in the Sentry URL). They go in **two places**: the
Workers Builds build variables of both `balier-dev` and `balier-admin-dev` (site/admin upload
runs on git push), and the repo root `.env` (cron uploads run locally — `deploy.mjs` falls back
to it). **Unverified until the token exists:** a real upload from all three builds, and — the
one to re-check on the first real cron error — that the cron's frame paths actually match the
uploaded artifact names (release-based matching is pickier than debug IDs; if traces stay
minified, `sentry-cli sourcemaps upload --strip-common-prefix` or a `~/` url-prefix is the
first knob).

## Open questions

- ~~Sentry account/org: created fresh as personal dev infra — confirm plan tier~~ **Resolved
  2026-08-09:** using the existing org we were invited into, and it stays ours after release
  (see Config above). Still owed before Phase 1 can start: the single `balier` project
  created (platform «Cloudflare Workers») and its DSN handed over.

## Out of scope (for now)

- **Browser-side Sentry** (`@sentry/browser` in layouts). The client catches —
  `CartPopup.astro:252`, `cart.astro:408`, `checkout.astro:676, 790` — are mostly "customer's
  network blinked". Different SDK, different noise profile; add only if asked.
- **Performance tracing / profiling** (`tracesSampleRate > 0`) — errors only for now.
- **Replacing Telegram business alerts or Workers Logs** — explicitly not the goal.
