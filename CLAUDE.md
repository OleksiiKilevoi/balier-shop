# balier.ua — online store

Store for the [@balier.ua](https://www.instagram.com/balier.ua/) brand (Instagram → own website).
Market: Ukraine. UI language: Ukrainian. Currency: hryvnia.

Work plan, current phase, and open decisions: `roadmap.md`. Read it before expanding scope — it
also lists questions that are deliberately unanswered, and building on a guessed answer is worse
than asking.

Phase 1 (foundation) is complete. The catalog, cart and checkout do not exist yet; `/products`,
`/cart`, `/about`, `/care` and the legal pages are linked from the header and footer but still 404.

---

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

Package manager is **pnpm**. Do not run `npm install` / `yarn`.

## Commands

```bash
pnpm dev              # local dev server — daemonised; `pnpm astro dev stop` / `logs` / `status`
pnpm build            # production build
pnpm preview          # serve the build in workerd via wrangler
pnpm deploy           # build + wrangler deploy
pnpm check            # astro check — .astro + TS types
pnpm cf-typegen       # regenerate worker-configuration.d.ts after editing wrangler.jsonc
pnpm db:generate      # drizzle-kit generate — SQL migration from the schema (works offline)
pnpm db:migrate       # apply migrations (needs DATABASE_URL)
pnpm db:studio        # drizzle studio
pnpm db:seed          # populate with development data (idempotent)
pnpm cron:dev         # run the cron worker locally with --test-scheduled
pnpm cron:deploy      # deploy the cron worker
```

Before considering a task done: `pnpm check && pnpm build`.

---

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

---

## Domain rules

These are not style preferences — getting them wrong breaks money and orders.

### Money

- All amounts are stored and passed as **integer kopiykas** (`integer`). No `float`/`numeric` for prices.
- Formatting into hryvnias happens only at the display boundary.
- Monobank currency: `ccy: 980` (UAH).
- The **server recalculates** the order total from DB prices. Prices and quantities coming from the
  client are treated as "intent" only and are always re-verified.

### Products and variants

Most products have no options at all; occasionally an item (a bag, say) comes in several colours.
The schema handles both with one shape — **there is no "product without variants" code path.**

- Every product has **at least one row** in `product_variants`. A plain product has exactly one.
- Stock, SKU and an optional price override live on the **variant**. Never put stock on `products`.
- Cart items, order items and stock reservations reference `variantId`, never `productId`.
- `product_images.variant_id` is nullable: `NULL` means the image is shared across all variants,
  a set value means it belongs to that colour only. Selecting a colour swaps the gallery.
- The variant selector is hidden in the UI when a product has a single variant. That is a rendering
  decision only — it changes nothing in the data model or the checkout logic.

### Orders

State machine; transitions move forward through the list only (plus cancellation/refund):

```
pending → awaiting_payment → paid → packed → shipped → delivered
                                  ↘ cancelled / refunded
```

For cash on delivery, `awaiting_payment` is skipped: `pending → confirmed → packed → shipped`.

- The order is created **before** calling Monobank, with a human-readable `orderNumber` (which is
  also the `reference` in `merchantPaymInfo`).
- Stock is reserved when the order is created, with a TTL. `stock_reservations` is the single source
  of truth for what is spoken for: **available = `variant.stock` − SUM(unexpired reservations)**.
  Never track a separate `reserved` counter — two sources of truth will drift. A cron releases
  reservations for stale unpaid orders (Phase 3).
- Order items **snapshot** product title, variant name, SKU and unit price. Rendering a historical
  order must never join back to the live catalog.
- The transition to `paid` happens **only in the webhook handler**, never on the `success` page.
  The user may close the tab before the redirect, and a redirect is trivial to forge.

### Idempotency

Monobank webhooks and repeated checkout submissions must be idempotent.
Mechanism: a unique constraint (`invoiceId`, `orderNumber`) plus `ON CONFLICT DO NOTHING` / a check
of the current status before transitioning. Redelivery of the same webhook must not send a second
email or a second Telegram notification.

---

## Integrations

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

---

## Design

Mockups live in `/design` (`home`, `products`, `product-single`, `checkout`). They are the reference
for anything visual — check them before inventing layout.

The look is warm leather goods: cream paper, espresso darks, a single rust accent carrying every
primary action. Type is Playfair Display (bold, headings and logo) over Inter (body).

- **All colour, radius and spacing values live in `@theme` in `src/styles/global.css`.**
  No raw hex anywhere else. Use the token utilities: `bg-paper`, `text-ink`, `text-ink-muted`,
  `border-line`, `bg-brand`, `bg-espresso`, `bg-tag`.
- Rust (`--color-brand`) means "the primary action on this screen" — one per view. Telegram keeps
  its own brand blue so it reads as a different channel, not a second-tier button.
- Fonts are self-hosted through Astro's font pipeline (`fonts` in `astro.config.mjs`); nothing is
  fetched from Google at runtime. Cyrillic subsets are mandatory.
  **Astro's `cssVariable` must not be a Tailwind theme key.** It injects the family into `:root` at
  runtime, which the Tailwind compiler never sees: point it at `--font-display` and the
  `font-display` utility compiles to nothing (silently — the class just does not exist), while
  `--font-sans` gets overwritten by Tailwind's own default system stack. So Astro owns
  `--font-playfair` / `--font-inter`, and `@theme` aliases `--font-display` / `--font-sans` to them.
  **Only the display face is preloaded** — adding `preload` to more families pushes competing
  requests ahead of the LCP heading. Pin `weights` and `styles` to what is actually painted, or
  Astro ships italic and unused weights.
- Existing building blocks: `Container`, `Button` (primary/secondary/telegram/ghost),
  `Price`, `ProductCard`, `Breadcrumbs`, `SiteHeader`, `SiteFooter`. Extend these rather than
  writing one-off markup.
- Product cards are square-image, white, bordered, with title → category → price stacking.
  Colour swatches render only when a product has more than one variant.

### Mobile first

The mockups in `/design` are desktop-only. They are the *widest* layout, never the starting point:
write the phone layout with unprefixed classes and add `sm:`/`md:`/`lg:` to grow into the mockup.
A `sm:`-prefixed class that makes something smaller (`sm:h-9`, `sm:text-sm`) is the expected
direction, not a mistake.

Non-negotiables, all enforced by tokens in `global.css`:

- **Touch targets ≥ `--spacing-touch` (44px)** for anything tappable — icon buttons, nav rows,
  footer links, steppers. Use `size-touch` / `min-h-touch` and tighten the surrounding gap; do not
  pad around the glyph, or the icon drifts away from where the badge is anchored.
  Where a control compacts back to the mockup size, it does so at **`md:`, not `sm:`** — 640px is
  still a phone in landscape.
- **Form fields are 16px on phones.** Under 16px, iOS Safari zooms the viewport on focus and never
  zooms back. `@layer base` sets this for bare fields; when a field carries its own size utility it
  must read `text-base sm:text-sm`. This matters most at checkout.
- Test at **320px** width. That, not 375px, is where a forced `<br />` or a fixed-width control
  first overflows.
- Prefer `dvh` over `vh` — mobile browser chrome makes `100vh` taller than the visible viewport.
- `--spacing-header` is the sticky header height. Anything computing viewport-minus-header, or any
  scroll offset, uses it rather than a repeated `4rem`.

## Code conventions

- TypeScript strict. `any` only with a comment explaining why nothing else works.
- Input validation uses zod; schemas live in `src/lib/validation/` and are shared by client and server.
- No React/Vue/Svelte islands. Interactivity is `.astro` + `<script>` with vanilla TS and nanostores.
  If a framework seems necessary, discuss it first.
- Components in `src/components/` are presentational and receive data via props.
  No DB queries inside components.
- DB naming: plural snake_case tables (`order_items`), snake_case columns, camelCase in TS via the
  Drizzle mapping.
- The DB schema changes **only** by editing `src/lib/db/schema.ts` and running `pnpm db:generate`.
  Do not hand-write SQL migrations and do not edit already-generated ones.
- UI text is Ukrainian. Do not hardcode user-facing strings into markup: UI strings live in
  `src/lib/i18n/`, product and page content lives in translation tables (i18n ships in Phase 6, but
  the schema is ready for it from day one).
- Mobile layout comes first. The main audience arrives from Instagram on a phone.

## Security

- Secrets live only in `wrangler` secrets / Cloudflare environment variables. Never in the
  repository, never in the client bundle. Public keys get the `PUBLIC_` prefix.
- `/admin/**` and admin APIs are behind Cloudflare Access, plus a server-side check of the Access JWT
  header inside the app — do not rely on edge configuration alone.
- Rate limiting on all public API routes (checkout, search, order creation).
- Do not log PII (phone, address, full name) or tokens. Telegram order notifications carry the
  minimum data needed.

## What not to do

- Do not set an order to `paid` anywhere except the webhook handler.
- Do not trust prices, totals, or stock coming from the client.
- Do not reference `productId` from a cart item, order item, or reservation — always `variantId`.
- Do not use Node-specific APIs or `process.env` at runtime.
- Do not add dependencies incompatible with the Workers runtime (native modules, heavy SDKs).
- Do not expand a phase's scope from `roadmap.md` without discussion — the timeline is tight (~2 weeks).
