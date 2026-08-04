# OVERVIEW — balier.ua

## What it is

An online store for the [@balier.ua](https://www.instagram.com/balier.ua/) leather-goods brand,
moving the business from Instagram onto its own website. Market: Ukraine. UI language: Ukrainian.
Currency: hryvnia. It is a server-rendered Astro app on Cloudflare Workers, backed by Postgres on
Neon, with Monobank for payment and Nova Poshta for delivery.

Work plan, current phase, and open decisions: `docs/plans/roadmap.md`. Read it before expanding
scope — it also lists questions that are deliberately unanswered, and building on a guessed answer
is worse than asking.

Phase 1 (foundation), the Phase 2 storefront and Phase 3 (cart, checkout, both payment methods, the
Monobank webhook, notifications, rate limiting) are built. Phase 4, the admin panel, has its auth
gate and nothing else yet: `/admin` exists as a placeholder behind Cloudflare Access.

The dev deployment lives at **`https://balier.mlosko.dev`**. The `workers.dev` URL is switched off —
it was a second public surface no Access policy could cover.

## Stack

| Layer | Technology |
|---|---|
| Framework | Astro (SSR, `output: 'server'`) + TypeScript strict |
| Adapter | `@astrojs/cloudflare` |
| Hosting | Cloudflare Workers (static assets) |
| Database | PostgreSQL on Neon (EU Frankfurt project) |
| ORM | Drizzle ORM + drizzle-kit |
| Styling | Tailwind CSS (`@tailwindcss/vite`) |
| Client state | nanostores + `@nanostores/persistent` (cart) |
| Payments | Monobank Acquiring |
| Shipping | Nova Poshta API |
| Bot protection | Cloudflare Turnstile |
| Admin access | Cloudflare Access |
| Notifications | Telegram Bot API + email |

## Architecture

Core principle: **business logic lives in `src/lib/`, not in `.astro` pages and not in API routes.**
A route parses the request, calls a function from `lib`, and formats the response. Everything else
belongs in `lib`.

This is the target shape — directories arrive with the phase that needs them, so several below do
not exist yet.

```
src/
  pages/
    index.astro
    products/index.astro, [slug].astro
    cart.astro, checkout.astro
    checkout/success.astro, failure.astro
    admin/**              # behind Cloudflare Access
    api/**                # API routes (export const prerender = false)
  layouts/
  components/             # .astro, reusable, no business logic
  lib/
    db/
      schema.ts           # single source of truth for the schema
      index.ts            # drizzle client factory
      queries/            # queries grouped by domain
    monobank/             # API client + webhook verification
    novaposhta/           # API client + reference data sync
    orders/               # order creation, state machine, reservations
    cart/                 # nanostores store + server-side validation
    notify/               # telegram, email
    validation/           # zod schemas shared by client and server
  stores/                 # client-side nanostores
migrations/               # SQL from drizzle-kit, committed to the repository
scripts/                  # Node-side tooling (seed). Runs outside workerd.
workers/cron/             # separate Worker holding the scheduled handlers
```

`~/*` is a path alias for `src/*` — use it instead of `../../..` chains.

### Cloudflare runtime — things to keep in mind

- This is **not Node.js**. No `fs`, `path`, or `process.env` at runtime, no native modules.
  Crypto is Web Crypto only (`crypto.subtle`).
- **Secrets and bindings come from `import { env } from 'cloudflare:workers'`.**
  `Astro.locals.runtime.env` was removed in Astro 6 and throws — do not use it, and be sceptical of
  older blog posts and snippets that still show it. Likewise: `Astro.request.cf` (not
  `locals.runtime.cf`), the global `caches` (not `locals.runtime.caches`), and
  `Astro.locals.cfContext` for `waitUntil` (not `locals.runtime.ctx`).
- Secrets are typed by declaration-merging `interface Env` in `src/env.d.ts`, because
  `wrangler types` only sees what is in `wrangler.jsonc`. Adding a secret means updating
  `src/env.d.ts` **and** `.dev.vars.example`.
- `import.meta.env` only works for public build-time variables.
- Every request gets a fresh isolate. **No module-scope caches or global state** between requests
  (immutable constants aside). For caching, use the Cloudflare Cache API or KV.
- The DB client is created **per request** via `createDb(env.DATABASE_URL)`. No global singleton.
- Heavy work after the response goes through `Astro.locals.cfContext.waitUntil()`, not an `await`
  before returning it.

### Scheduled jobs live in `workers/cron/`

The Astro adapter owns the app Worker's entrypoint and exports only `fetch`, so a `scheduled`
handler cannot be added to it. Crons therefore run as a **second Worker** with its own
`wrangler.jsonc` and its own secrets, importing shared code from `src/lib/`. It deploys separately
(`pnpm cron:deploy`) — deploying the app does **not** deploy the crons, and vice versa.

### Neon + Drizzle: two drivers

Both are wrapped in `src/lib/db/index.ts`; use those helpers rather than constructing clients inline.

- **`createDb(url)`** → `drizzle-orm/neon-http`. The default for reads. One HTTP round trip per
  query, nothing to clean up. **Does not support interactive transactions.**
- **`createTxDb(url)`** → `drizzle-orm/neon-serverless` (`Pool` over WebSocket), for anything that
  must be atomic: creating an order with its stock reservation, and the Monobank webhook transition.
  Returns `{ db, close }`; the caller must `ctx.waitUntil(close())` in a `finally`.

Rule: any operation that changes stock and order status at the same time runs in a transaction.

## Module map

What exists in the repository today, as distinct from the target shape above.

| Path | Purpose |
|---|---|
| `src/pages/index.astro` | Homepage — hero, featured products, page teasers, delivery/payment/returns strip |
| `src/pages/products/index.astro` | Catalog grid with breadcrumbs and product count |
| `src/pages/products/[slug].astro` | Product page — gallery, variants, details, the two CTAs |
| `src/pages/products/category/[slug].astro` | Category grid, reached from the product page's category pill |
| `src/pages/search.astro` | Plain GET search form + results; no API route, no autocomplete |
| `src/pages/cart.astro` | The cart — client-rendered from `/api/cart`; rows cloned from a `<template>` |
| `src/pages/api/cart.ts` | Server-side pricing and stock validation; what checkout will also call |
| `src/pages/media/[...key].ts` | Byte pump for R2 objects; immutable caching |
| `src/pages/checkout.astro` + `checkout/{success,failure}.astro` | The order form and its two outcomes |
| `src/pages/api/checkout.ts`, `api/checkout/*` | Order creation; the COD limit and the two Nova Poshta lookups |
| `src/pages/api/webhooks/monobank.ts` | The only place an order becomes `paid` |
| `src/pages/admin/index.astro` | Placeholder panel home — behind Access, shows the signed-in identity |
| `src/layouts/AdminLayout.astro` | Admin shell; deliberately not `BaseLayout` (no storefront chrome) |
| `src/middleware.ts` | Two gates in sequence: the `/admin/**` Access check, then per-IP rate limiting |
| `src/lib/access/index.ts` | Access JWT verification — the app-side half of the admin gate (+ tests) |
| `src/lib/orders/` | Order creation, the state machine, stock reservations |
| `src/lib/monobank/index.ts` | `PaymentPort` — invoices, status, ECDSA webhook verification (+ tests) |
| `src/lib/novaposhta/` | `ShippingPort` client + the reference-data sync the cron runs |
| `src/lib/notify/` | `telegram.ts`, `email.ts` (both `NotifierPort`), shared `format.ts` |
| `src/lib/turnstile/index.ts` | `CaptchaPort` — server-side siteverify at checkout |
| `src/lib/rateLimit/index.ts` | KV fixed-window counter behind the middleware |
| `src/pages/404.astro` | Rewrite target for unknown or non-`active` slugs |
| `src/pages/{about,care,delivery,returns,contacts,offer,privacy}.astro` | The seven static pages; copy still pending |
| `src/layouts/BaseLayout.astro` | Document shell, fonts, `SITE_IS_INDEXABLE` |
| `src/layouts/StaticPageLayout.astro` | Shared frame for the seven static pages |
| `src/components/` | `Container`, `Button`, `Price`, `ProductCard`, `ProductGallery`, `QuantityStepper`, `Breadcrumbs`, `ContentPlaceholder`, `SiteHeader`, `SiteFooter` |
| `src/stores/cart.ts` | The browser cart — variant ids and quantities only, persisted to `localStorage` |
| `src/lib/cart/index.ts` | Pure totals: pricing from DB rows, clamping to stock, correction notices (+ `index.test.ts`) |
| `src/lib/db/schema.ts` | The 15-table schema — single source of truth |
| `src/lib/db/index.ts` | `createDb` / `createTxDb` factories |
| `src/lib/db/queries/` | `products.ts`, `categories.ts`, `cart.ts`, `stock.ts` (the one definition of *available*), `locale.ts` |
| `src/lib/media/index.ts` | Content-hash keys, format allowlist, `storeImage`, `mediaUrl` |
| `src/lib/telegram/index.ts` | `orderDeepLink` — shared by the page and its client script |
| `src/lib/money.ts` | The `Kopiykas` type and formatting |
| `src/lib/ports.ts` | `PaymentPort`, `ShippingPort`, `NotifierPort`, `CaptchaPort` — the boundaries domain code depends on |
| `src/lib/i18n/plural.ts` | Ukrainian plural forms |
| `src/lib/i18n/cart.ts` | The cart's dynamic strings — built in the browser, so they cannot live in markup |
| `src/lib/validation/` | `search.ts`, `cart.ts` — zod schemas shared by client and server |
| `src/styles/global.css` | `@theme` tokens; `prose-page` utility |
| `migrations/` | `0000_late_omega_flight.sql`, `0001_handy_sheva_callister.sql` + drizzle metadata |
| `scripts/` | `seed.ts`, `ingest-images.ts`, `media-push.ts`, `test-catalog.ts` — Node-side, outside workerd |
| `workers/cron/` | Second Worker; handlers stubbed for Phase 3 |
| `design/` | Desktop mockups: `home`, `products`, `product-single`, `checkout` |

## External pieces

> The endpoints and fields below are a guide. Check the current documentation before implementing:
> Monobank — https://api.monobank.ua/docs/acquiring.html, Nova Poshta — https://developers.novaposhta.ua/

### Monobank Acquiring

- Base URL `https://api.monobank.ua/api/merchant/`, authorization via the `X-Token` header.
- Invoice creation: `POST invoice/create` → `{ invoiceId, pageUrl }`. Redirect the user to `pageUrl`.
- Webhook: the `X-Sign` header is a base64 ECDSA-SHA256 signature of the **raw request body**.
  The public key comes from `GET merchant/pubkey`; cache it (KV), and on a failed verification
  re-fetch the key once (rotation) before rejecting.
- Webhook handling order — do not change it:
  1. read the raw body as text (not `.json()` — the signature is computed over the bytes);
  2. verify `X-Sign`, otherwise return `403`;
  3. **re-check the status via `GET invoice/status?invoiceId=...`** — do not trust the webhook body;
  4. transition the order inside a transaction, if the transition is valid;
  5. respond `200` quickly; send notifications via `waitUntil`.
- Statuses: `created`, `processing`, `hold`, `success`, `failure`, `reversed`, `expired`.
- The client's token only arrives in Phase 5; until then, use the test token.

### Nova Poshta

- A single endpoint: `POST https://api.novaposhta.ua/v2.0/json/`,
  body `{ apiKey, modelName, calledMethod, methodProperties }`.
  Errors arrive with HTTP 200 and `success: false` — **always check `success`, not the status code.**
- Reference data (settlements, branches/parcel lockers) is **synced into our own DB by cron** and
  served from there. Do not proxy autocomplete straight to the NP API on every keystroke.
- Cash on delivery uses `BackwardDeliveryData` with `CargoType: 'Money'`; who pays the commission is
  fixed in the store settings (Phase 0/4).
- The cash-on-delivery amount limit is configurable in the admin panel and enforced on the server.

### Turnstile, Telegram, email

- Turnstile is validated **on the server** (`siteverify`) at checkout. The client widget guarantees
  nothing on its own.
- Telegram notifications and emails are best-effort: their failure must not break order placement.
  Log the error, but return success to the user if the order was created.

### Cloudflare bindings and accounts

- `MEDIA` (R2 bucket `balier-media`), `IMAGES`, and the `RATE_LIMIT` KV namespace (backs
  `src/middleware.ts`) are bound in `wrangler.jsonc`. `CACHE` is still commented out — nothing
  needs it yet.
- The Neon project, the Cloudflare account **and the `mlosko.dev` domain** are the developer's own,
  for development only. The store ships on the client's accounts, stood up again during Phase 5.
  `mlosko.dev` was bought because both Cloudflare Access and Email Sending need a *zone on the
  account* and `*.workers.dev` cannot be one; `balier.ua` replaces it at launch.

### Cloudflare Access — the admin gate

- Zero Trust team `mlosko`; one self-hosted application over four destinations on
  `balier.mlosko.dev`: `admin`, `admin/*`, `api/admin`, `api/admin/*`.
- **Login is one-time PIN**, not a Cloudflare account: the admin types an email, receives a 6-digit
  code, and is in. Adding an admin is adding an address to the Allow policy. This is why the app
  does not hand-roll email/password auth — it would buy nothing and cost password hashing, sessions
  and reset flows in a runtime with no native bcrypt/argon2.
- Access authenticates at the edge; `src/middleware.ts` **independently verifies the JWT** it
  forwards (`Cf-Access-Jwt-Assertion`, falling back to the `CF_Authorization` cookie). Unconfigured
  means deny. `pnpm dev` bypasses the gate behind `import.meta.env.DEV`, a build-time constant that
  is `false` in everything `pnpm build` emits.
- `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are Worker secrets. Neither is a credential — security
  rests on the RS256 signature — but both are account-specific and change in Phase 5.

## Known sharp edges

Each of these has already cost time at least once.

- **`pnpm-workspace.yaml` holds settings (`allowBuilds`), not a workspace.** pnpm 10+ reads that
  file as a workspace definition and fails the install outright with `packages field missing or
  empty` — which is how a CI runner that picks its own pnpm breaks the build. Do not drop the
  `packageManager` field from `package.json`.
- **A plaintext dashboard variable does not survive a deploy.** Workers Builds sends the `vars`
  block from `wrangler.jsonc` as the *complete* set of plaintext variables, so anything added in
  the dashboard as Text is silently dropped by the next push. This took the deployed site down
  once: `DATABASE_URL` vanished, every DB-backed route 500ed, and the homepage — which queries
  nothing — stayed green. Encrypted secrets live outside that file and are preserved.
- **An Access path matches exactly, and a wildcard does not cover its own parent.** `admin` protects
  `/admin` but *not* `/admin/orders`; `admin/*` protects `/admin/orders` but *not* `/admin`. Both
  are needed, per path — which is why the application carries four destinations for what looks like
  two. Getting this wrong leaves an admin route silently unprotected at the edge, with nothing in
  the dashboard flagging it.
- **Adding a `routes` entry silently disables the `workers.dev` URL.** wrangler defaults
  `workers_dev` to `false` as soon as any route exists, so the first deploy with a custom domain
  took the old test URL offline mid-session. That is the behaviour we want here, so it is now
  written explicitly in `wrangler.jsonc` — but it arrives as a warning in deploy output, not an
  error, and is easy to miss.
- **`wrangler types` reads `.dev.vars`, not `src/env.d.ts`.** Declaration-merging `interface Env`
  in `env.d.ts` does not reach the `env` imported from `cloudflare:workers` (that is typed against
  `Cloudflare.Env`). A new secret has to exist in `.dev.vars` before `pnpm cf-typegen` will type it,
  whatever `env.d.ts` says.
- **`wrangler.jsonc`'s `name` must match the Worker being deployed to (`balier-dev`).** A mismatch
  does not error — `wrangler deploy` just creates a second, empty Worker under the config's name,
  leaving the live one untouched and the failure invisible.
- **Astro's font `cssVariable` must not be a Tailwind theme key.** It injects the family into
  `:root` at runtime, which the Tailwind compiler never sees: point it at `--font-display` and the
  `font-display` utility compiles to nothing (silently — the class just does not exist), while
  `--font-sans` gets overwritten by Tailwind's own default system stack. So Astro owns
  `--font-playfair` / `--font-inter`, and `@theme` aliases `--font-display` / `--font-sans` to them.
- **`/media/**` must never call the Images binding to transform.** Cloudflare bills *unique*
  transformations per month and, on the free plan, errors instead of billing once the allowance is
  spent — a per-request transform would put a monthly quota in front of every product photo.
  (`IMAGES.info()` for intrinsic width/height is fine, and is the only use of the binding in
  `src/lib/media/`.)
- **A horizontal scroller inside a grid item still widens the track.** `overflow-x` only zeroes the
  *automatic minimum size* of flex/grid items, and a plain block scroller is neither — the gallery
  thumbnail strip forced both columns to 352px in a 320px viewport until `min-w-0` went on the grid
  children.
- **Headless Chrome cannot be screenshotted at 320px with `--window-size`.** Windows clamps the
  browser window to roughly 500px minimum and the page silently lays out wider. Use CDP
  `Emulation.setDeviceMetricsOverride` and check `Page.getLayoutMetrics.cssContentSize`.
- **`Container` used not to forward attributes**, so an `aria-labelledby` on a
  `<Container as="section">` was dropped with no error anywhere and the section shipped unlabelled.
  It spreads now — but the class of bug (a component silently swallowing props) is worth watching for.
