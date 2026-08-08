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
project identifier, not a secret). `environment: 'development'` until the Phase 5 account
swap — the Sentry account is personal dev infra like Neon/Cloudflare/Monobank and goes on the
same swap-at-release list.

## Phases

### Phase 1 — the safety net: wrappers [todo]

Three wrap points cover every unhandled error in the codebase (~30 lines total).
`pnpm add @sentry/cloudflare` in `apps/site`, `apps/admin`, `workers/cron`.

- [ ] `apps/site/src/middleware.ts` — `Sentry.wrapRequestHandler` as the **first** middleware in
      the `sequence`, passing `context.locals.runtime.ctx` as the ExecutionContext (the SDK
      flushes via `waitUntil`). Covers all pages + all 6 API routes.
- [ ] `apps/admin/src/middleware.ts` — same wrapper, covers the whole panel.
- [ ] `workers/cron/index.ts` — `Sentry.withSentry((env) => ({ dsn: env.SENTRY_DSN, … }), handler)`
      around the default export; it understands `scheduled`. Covers all three jobs.
- [ ] `SENTRY_DSN` + `environment` in the three `wrangler.jsonc` `vars` blocks.

**Notes/decisions:** `tracesSampleRate: 0` — errors only, no performance tracing for now.
The wrapper is catch-report-**rethrow**: the user still gets their 500, nothing is silenced.

### Phase 2 — manual captures in swallowed catches [todo]

The wrappers only see errors that *reach* them. These sites deliberately catch-and-continue, so
each needs one line: `Sentry.captureException(err)` inside the existing `catch`, or
`Sentry.captureMessage(…)` where there is no exception, just a business anomaly currently logged
with `console.error`/`warn`. Thanks to AsyncLocalStorage, a capture called from deep inside
`packages/lib` attaches to the right request automatically — nothing needs threading through.

**Money / payments (most important):**

- [ ] `reconcileAwaitingPayment` — `workers/cron/index.ts:159` — Monobank unreachable, invoice
      not reconciled (captureException)
- [ ] `reconcileAwaitingPayment` — `workers/cron/index.ts:151` — payment landed on a cancelled
      order, manual refund owed (captureMessage)
- [ ] Monobank webhook `POST` — `apps/site/src/pages/api/webhooks/monobank.ts:68` — same case
      via webhook (captureMessage)
- [ ] `createOrder` compensation — `packages/lib/src/orders/create.ts:293` — order rolled back
      but the Monobank invoice couldn't be removed: a live payment link is left dangling
      (captureException)
- [ ] `updateOrderStatus` — `packages/lib/src/orders/updateStatus.ts:181` — same dangling-invoice
      case on admin cancellation (captureException)

**Delivery / Nova Poshta:**

- [ ] `trackWaybillStatuses` — `workers/cron/index.ts:232` — carrier status failed to apply to an
      order (captureException)
- [ ] `trackWaybillStatuses` — `workers/cron/index.ts:211` — unknown NP status code
      (captureMessage)
- [ ] `syncNovaPoshtaReferenceData` — `packages/lib/src/novaposhta/sync.ts:366` — sync anomaly
      (captureMessage)
- [ ] waybill compensation — `apps/admin/src/pages/orders/[orderNumber].astro:179` — TTN created
      at NP but not recorded in DB and not deleted: orphaned waybill (captureException)
- [ ] register compensation — `apps/admin/src/pages/registers/index.astro:99` — same for a
      registry sheet (captureException)

**Notifications (silent failures):**

- [ ] `createEmailNotifier` → `orderPaid` — `packages/lib/src/notify/email.ts:97` — customer
      email didn't send (captureException)
- [ ] `sendTelegramMessage` — `packages/lib/src/notify/telegram.ts:100, 106` —
      **Telegram sends themselves failed**; Telegram is our alert channel *and*, since
      `792dc66`, the delivery channel for admin OTP login codes — when it is down Sentry is the
      only place that shows it (captureException)

**Admin OTP login via Telegram (`792dc66`):**

- [ ] OTP dispatch — `apps/admin/src/pages/login/telegram.astro:140` — the
      `issueOtp` + `sendTelegramMessage` chain runs off the response path with a bare
      `.catch(() => {})`: on failure the operator sees «надіслано», no code ever arrives, and
      today nothing is logged anywhere. The single most valuable capture in the feature —
      `.catch((err) => Sentry.captureException(err))`
- [ ] `recordAdminLogin` bookkeeping — `apps/admin/src/pages/login/telegram.astro:192` — same
      bare `.catch(() => {})`; deliberately best-effort, but a silently failing DB write is
      still worth one line (captureException, low priority)
- [ ] *No capture needed* in `apps/admin/src/pages/telegram/webhook.ts` or
      `packages/lib/src/db/queries/adminTelegram.ts`: the webhook deliberately lets a thrown
      query escape as a 500 (Telegram retries), so the Phase 1 wrapper sees it — the route is
      on the auth gate's allowlist, but the Sentry middleware runs regardless; the webhook's
      best-effort reply goes through `sendTelegramMessage`, covered above

**Storefront SSR:**

- [ ] settlement suggestions fallback — `apps/site/src/pages/checkout.astro:41` — server-side
      catch, same SDK as the rest (captureException)

**Notes/decisions:** `packages/lib` gains a direct `@sentry/cloudflare` dependency. The cleaner
alternative — an `onError` callback threaded through the existing factories à la `ports.ts` —
costs more code for no behaviour difference; revisit only if the lib dependency starts to hurt
(e.g. tests, or reuse outside Workers).

### Phase 3 — readable stack traces: sourcemaps [todo]

- [ ] `@sentry/vite-plugin` in both `astro.config.mjs` files (and sourcemap upload for the cron
      Worker) with `SENTRY_AUTH_TOKEN` in the Workers Builds build environment — deploys happen
      on git push, so upload must run there, not locally.

**Notes/decisions:** optional quality-of-life; Phase 1+2 are useful without it, stack traces are
just minified.

## Open questions

- Sentry account/org: created fresh as personal dev infra — confirm plan tier (the free tier's
  5k events/month is plenty at current traffic).

## Out of scope (for now)

- **Browser-side Sentry** (`@sentry/browser` in layouts). The client catches —
  `CartPopup.astro:252`, `cart.astro:408`, `checkout.astro:676, 790` — are mostly "customer's
  network blinked". Different SDK, different noise profile; add only if asked.
- **Performance tracing / profiling** (`tracesSampleRate > 0`) — errors only for now.
- **Replacing Telegram business alerts or Workers Logs** — explicitly not the goal.
