# Online Store Development Plan

Estimate: ~2 weeks of build time, plus Phase 0 waiting on third parties.

Status legend: `[x]` done · `[~]` partially done · `[ ]` not started · `[?]` blocked on a decision

---

## Open decisions

These come from the mockups in `/design` contradicting or extending the plan below. Each one
changes scope, so they are recorded here rather than guessed at. Nothing downstream is built on
an assumed answer.

*None outstanding.*

### Decided

- **Delivery cost — the site never quotes one** (2026-08-03, was open decision 1). Nova Poshta is
  paid by the recipient at the carrier's own tariff, exactly as the cart mockup says, so the summary
  shows «Нова Пошта — за тарифами перевізника» as text and «Разом» is the goods alone.
  Consequences, all of them removals: no delivery quoting, no per-product weight or dimensions, no
  delivery cost in the order total, and **Monobank is only ever charged for goods**.
  `CartSummary.deliveryTotal` exists and is always 0 — `orders.delivery_total` is in the schema
  either way, and free delivery over a threshold would need somewhere to live.

- **Newsletter signup — removed from the footer** (2026-08-03). It is not a release feature, and a
  field that silently does nothing is worse than no field. The footer is now three columns instead
  of the mockup's four. Email campaigns stay in Phase 6; bringing the form back means bringing back
  the storage, the endpoint and the consent record together, not just the markup.

- **"Замовити через Телеграм" is a plain deep link, not a second ordering path** (2026-08-03).
  `t.me/<manager>?text=…` with the title, colour, SKU, unit price, quantity and product URL
  prefilled; the manager takes the conversation from there. It writes no order row, reserves no
  stock and touches no payment, so it stays entirely inside Phase 2 and pulls nothing from Phase 3.
  Built in `src/lib/telegram/`, imported by both the page and its client script so the message a
  customer sends cannot drift from the one rendered server-side.
  The manager account itself is still a Phase 0 item: `PUBLIC_TELEGRAM_MANAGER` in `wrangler.jsonc`
  holds a **placeholder handle**, and `orderDeepLink` validates it, so clearing the var hides the
  button rather than shipping a link to a stranger.
- **EN/UA language switcher — removed.** English is not planned for release, so the toggle shown in
  the mockups is gone from the header (2026-08-03). The site ships Ukrainian only; i18n stays in
  Phase 6 and the DB translation tables stay in the schema, unused for now.
- **Product images live in R2, and we do not resize them** (2026-08-03). Photography is prepared at
  the right size before upload, so one file is one object is one URL. `/media/**` serves bytes
  straight out of the `balier-media` bucket and never calls the Images binding to transform:
  Cloudflare bills *unique* transformations monthly and, on the free plan, **errors instead of
  billing** once the 5 000/month allowance is gone, which would put a monthly quota in front of
  every product photo.
  Two details that exist to keep Phase 5 cheap: keys are content hashes (immutable, so cache
  invalidation never arises), and `product_images.url` holds a **site-relative path**, so moving to
  the client's bucket and domain rewrites no rows. Committing images to the repo was rejected —
  Workers static assets are written at deploy time, so the admin panel could never manage them.

---

## Phase 0 — Preparation

External dependencies with real waiting time. Start these in parallel with Phase 1 — they are on
the critical path and nothing here is under our control.

- [ ] Register for Monobank Acquiring
- [ ] Nova Poshta API (NP account, business account), configure cash on delivery, decide who pays
      the transfer commission
> **The Neon project and the Cloudflare account are the developer's own, for development only.**
> The store ships on the client's accounts, stood up again during Phase 5. Nothing in the current
> setup is production: plan limits, retention and backups are decisions for that account, and the
> data here is seed data. Keep the setup reproducible — that is the part being handed over.

- [x] Neon project, EU Frankfurt — created 2026-08-03 on the Free plan, Postgres 18. Database is
      the default `neondb` (not `balier`). `DATABASE_URL` in `.dev.vars` is the **pooled** string;
      `db:migrate` and `db:seed` both ran clean through it. The cron Worker needs its own copy in
      Phase 3 — secrets are per-Worker and do not carry over
- [~] Cloudflare account — done, deploying through Workers Builds (dashboard, not CLI).
      **`DATABASE_URL` must be an encrypted Secret on the `balier-dev` Worker, not a plaintext
      variable.** It was recorded here as set, and on 2026-08-03 it was not: `wrangler secret list`
      returned `[]` and every DB-backed route 500ed with «No database connection string was provided
      to `neon()`» while the homepage, which queries nothing, kept returning 200. A plaintext
      variable added in the dashboard does not survive a deploy — Workers Builds sends the `vars`
      block from `wrangler.jsonc` as the complete set, so anything not in that file is dropped.
      Encrypted secrets are not in that file and are preserved. The remaining secrets wait on
      Phase 0's other items
- [x] **R2 bucket `balier-media`** — created 2026-08-03, wrangler login restored. The 16 dev photos
      were pushed to it with `pnpm media:push` and verified byte-for-byte. Note this is still the
      *developer's* account: Phase 5 creates the bucket again on the client's and re-pushes, exactly
      like Neon
- [ ] Telegram: manager account for the deep link, bot and chat for notifications
- [ ] Confirm Neon plan covers the backup/PITR window we need — **applies to the client's project,
      not this dev one**, so it moves back to Phase 5. Free gives 6 h restore and 0.5 GB, Launch
      7 days, Scale 30 days. 6 h is too thin once real orders exist; the upgrade needs no code change

## Phase 1 — Foundation (2–3 days) — done

- [x] Create the repository: astro, typescript, wrangler, drizzle
- [x] DB schema and initial migration (`migrations/0000_late_omega_flight.sql`), seed script
      — applied to Neon 2026-08-03: 15 tables, seed gives 1 category, 2 products, 4 variants
- [x] Reusable design components: `Container`, `Button`, `Price`, `ProductCard`, `Breadcrumbs`,
      `SiteHeader`, `SiteFooter`
- [x] Types and ports (`src/lib/ports.ts`): payment, shipping, notifier, captcha
- [x] Base page layout, design tokens, self-hosted Cyrillic fonts
- [x] Build verified (`pnpm check` + `pnpm build`), homepage renders
- [x] Verify a real deploy — live at `balier.mlosko.dev`, deployed by
      Cloudflare Workers Builds from GitHub `main` (2026-08-03). Immutable asset caching, the
      self-hosted Cyrillic fonts and the mobile layout all confirmed on the deployed artifact.

Decisions locked during this phase:

- **Cloudflare Workers, not Pages.** The Astro adapter now targets Workers, and Pages is the legacy
  path.
- **Crons live in a second Worker** (`workers/cron/`). The Astro adapter owns the app Worker's
  entrypoint and exports only `fetch`, so a `scheduled` handler cannot be attached to it. The two
  deploy independently.
- **Variants are always present.** Every product has at least one `product_variants` row; stock and
  SKU live there, never on `products`. See `CLAUDE.md` for the full rule.

## Phase 2 — Catalog, storefront (3 days) — built, copy pending

Full mockups exist for every page here, so there is little left to design. Every page now exists
and renders; the only thing outstanding is the text of the seven static pages, which is a Phase 5
content item and a Monobank gate, not a build one.

- [x] **Image storage and the dev catalog** — R2 bucket binding (`MEDIA`), `src/lib/media/`
      (content-hash keys, format allowlist, the shared `storeImage`), the `/media/[...key]` route,
      and `pnpm media:ingest`. Three real products seeded from `test-products/` with 16 photos:
      Lunet (5500 ₴), Space (4800 ₴), гаманець (1950 ₴). The two synthetic Phase 1 products are kept
      deliberately — between them they cover the multi-variant selector and the "no photography"
      placeholder, which the real three do not. Ingest runs against the **local** R2 simulator, so
      it needs no Cloudflare login; the real bucket does not exist yet (see Phase 0)
- [x] Homepage — hero, «Обрані товари», teasers for `/about` and `/care`, then the delivery /
      payment / returns strip moved below them, where it answers "how do I get this" instead of
      interrupting the products.
      Featured products come from `listFeaturedProducts`, which orders by **`is_featured DESC`
      rather than filtering on it**: the flag floats a product to the front of the row, it does not
      gate the row's existence, so a client who has flagged nothing, flagged two, or archived the
      three they had flagged still gets a full grid of the newest products. The section cannot be
      emptied or left ragged from the admin panel, only reordered.
      No database constraint caps how many products carry the flag — that would hand the client a
      Postgres error and no way to see which slots are taken. The extras just fall past the query's
      `limit`, which is **4**: the row is two cards on a phone and four at `lg`, so five would leave
      a ragged trailing card at every width. Phase 4 adds one checkbox to the product form and
      nothing else.
      The teaser copy is placeholder-grade on purpose — the real text arrives with the pages
      themselves, and writing a brand story here would just mean writing it twice.
      Found and fixed on the way: `Container` never forwarded attributes, so an `aria-labelledby` on
      a `<Container as="section">` was dropped with no error anywhere and the section shipped
      unlabelled. It spreads now
- [x] `/products` page — breadcrumbs, product count, grid. `src/lib/db/queries/products.ts`
      (`listActiveProducts`) and `src/lib/db/queries/stock.ts` (the one definition of
      `available = stock − unexpired reservations`, which Phase 3 reuses). Two columns on a phone,
      three at `md`, the mockup's four at `lg`. Grid ordering is `position`, then newest first
- [x] `/products/[slug]` page — `ProductGallery` (a gapless CSS scroll-snap carousel: swipe is the
      browser's own, script only mirrors the scroll position into the dots and thumbnails and drives
      the reverse on a thumbnail click; dots on a phone, the mockup's thumbnail strip from `sm:`),
      category pill, description, details list, dimensions block, `QuantityStepper`, and the two
      CTAs. The colour selector is rendered
      for every product and carries `hidden` when there is only one variant, so the client script
      always has one place to read the current variant from.
      **«Додати до кошика» is markup only** — styled and stock-aware (disabled when the chosen
      variant has none available), but wired to nothing until the cart store lands in Phase 3.
      An unknown or non-`active` slug rewrites to the new `src/pages/404.astro`
- [x] Category pages — `/products/category/[slug]`, reached from the category pill on
      `/products/[slug]`, which is now a link (with the phone-sized hit area, compacting at `md:`
      like the footer links). Same card grid, ordering and count header as `/products`, via the
      shared `selectProductCards` path (`getCategoryBySlug` in `queries/categories.ts`,
      `listProductsInCategory` in `queries/products.ts`; `LOCALE` moved to `queries/locale.ts` so it
      stays one constant). An unknown, deactivated or untranslated category slug 404s; deactivating
      a category keeps the pill's text on the product page but drops the link, since the page it
      would point at 404s. There is deliberately no category nav on `/products` yet — it was not asked for, and it is a
      one-component addition later
- [x] Product search — `/search`, which the header icon now actually reaches. A plain GET form, so
      the query lives in the URL and the page works before any script does; there is no autocomplete
      and no API route. `searchProducts` in `src/lib/db/queries/products.ts` matches **substrings**,
      not Postgres FTS: Postgres ships no Ukrainian dictionary and the `simple` configuration only
      lowercases, so «сумки» would not find «сумка» — the exact lookup a shopper types. All tokens
      must match, each anywhere in the title, description, category, colour name or SKU, and title
      hits rank first. The `/products` grid and the results grid now share one card-assembly path,
      so they cannot drift. Verified against Neon: colour and SKU lookups hit, LIKE metacharacters
      (`%`, `_`) are escaped and match literally, and 320px lays out with no overflow.
      If the catalog ever outgrows a sequential scan, the fix is a `pg_trgm` GIN index over the same
      expression — not a different matching rule
- [~] Static pages: `/about`, `/care`, `/delivery`, `/returns`, `/contacts`, `/offer`, `/privacy`
      — all seven now exist and return 200. **Copy is still missing**: each page renders its
      heading, a one-line lead and a `ContentPlaceholder` that says the text is being prepared.
      Lorem ipsum and invented terms were rejected deliberately — a plausible-looking legal page is
      worse than an obviously empty one, and **the legal ones are a hard gate for Monobank
      approval, not decoration**. Filling them in stays a Phase 5 item; deleting the
      `ContentPlaceholder` import is what marks a page as written.
      Shared frame in `src/layouts/StaticPageLayout.astro` (breadcrumbs, `h1`, lead, slot) with the
      body typography in the `prose-page` utility in `global.css`, so a finished page is plain
      headings and paragraphs with no classes. `/offer` and `/privacy` were linked from nowhere —
      they are now a legal row in the footer's bottom bar
- [x] Mobile layout — every Phase 2 page is written phone-first and verified to lay out
      inside 320px with no horizontal overflow. Two traps worth remembering:
      **(1)** a horizontal scroller inside a grid item still widens the track. `overflow-x` only
      zeroes the *automatic minimum size* of flex/grid items, and a plain block scroller is neither,
      so the thumbnail strip forced both columns to 352px in a 320px viewport until `min-w-0` went
      on the grid children.
      **(2)** headless Chrome cannot be screenshotted at 320px with `--window-size` — Windows clamps
      the browser window to a minimum width of roughly 500px and the page silently lays out wider.
      Use CDP `Emulation.setDeviceMetricsOverride` and check `Page.getLayoutMetrics.cssContentSize`.
      `/search` is verified the same way, in all three states (no query, results, nothing found),
      as are the seven static pages — `cssContentSize` is 320 on each, and the longest heading
      («Політика конфіденційності») wraps rather than overflowing. The homepage is verified at both
      320 and 1280 with the featured grid populated

## Phase 3 — Cart and payment (3 days — realistically 5–6) — money path done, extras pending

The heaviest phase by a wide margin. Consider splitting notifications out.

The whole card money path is verified live end to end against the deployed dev Worker — order →
Monobank → webhook → `paid`, with the Telegram «Оплачено» message landing in the manager group. What
is left in this phase is one deliberately-deferred extra — order-confirmation email — now that rate
limiting is done too.

- [x] **Cart (nanostores + persist), server-side validation of prices and stock** — `src/stores/cart.ts`
      stores `{ variantId, quantity }` and nothing else, so a hand-edited `localStorage` entry can
      change what someone intends to buy but never what it costs. `POST /api/cart` resolves those ids
      against the DB (`findCartVariants`) and `buildCartSummary` prices them, clamps each quantity to
      `available`, drops what is gone and returns a notice for every correction. The stored cart is
      then overwritten with the server's answer, so the header badge converges too. Not yet rate
      limited — that is its own item below, waiting on the KV namespace
- [x] `/cart` page — entirely client-rendered (the cart lives in `localStorage`, so the server has
      nothing to render from): four states toggled by `hidden`, rows cloned from a `<template>` so the
      markup stays in Astro. A quantity change repaints instantly from the last server price and
      revalidates on a 600 ms debounce, which collapses a burst of «+» presses into one request; rows
      are updated in place rather than rebuilt, or the revalidation would take focus off the stepper
      the customer is still pressing. `QuantityStepper` moved to delegated listeners for the same
      reason — a per-element binding leaves every cloned row dead. Verified at 320 px and 1280 px
      against Neon, including the sold-out, clamped, network-failure and empty paths
- [x] `/checkout` page — one form, delivery and payment method switching the fields below it.
      Settlement and warehouse are search comboboxes against the synced Nova Poshta tables (Kyiv
      alone has 7 756 warehouses, so a plain `<select>` could not work); `+380` is a fixed prefix
      chip and the input holds 9 auto-formatted local digits (`src/lib/phone.ts`)
- [x] Create the `RATE_LIMIT` KV namespace and bind it in `wrangler.jsonc` (`CACHE` stays
      uncreated — nothing needs it yet, so creating it now would be unused scope)
- [x] Cron for syncing Nova Poshta reference data — `syncNovaPoshta` in `workers/cron/`, real and
      run successfully against the live API. **The `balier-cron` Worker itself has never been
      deployed**, so nothing runs it on a schedule yet — `pnpm cron:deploy` plus its own runtime
      secrets (`DATABASE_URL`, `NOVAPOSHTA_API_KEY`)
- [x] Payment methods: card / cash on delivery — cash on delivery commits the sale inside the
      creating transaction (nothing to wait on); card leaves the stock reservation live and calls
      Monobank *outside* the transaction, rolling the order back to `cancelled` if the invoice call
      itself fails. Both verified live against the real dev Neon DB and the real Monobank test
      merchant
- [x] Webhook handler: X-Sign verification, idempotency, re-check via invoice/status, transition the
      order to paid — `src/lib/orders/confirmPayment.ts` is the only place an order becomes `paid`,
      and it re-checks `invoice/status` rather than trusting the webhook body. Verified live: a real
      Monobank callback carrying a real `X-Sign` took an order to `paid`. Two things only live
      testing could have found: `X-Sign` is DER and needs converting to raw, and `GET /pubkey`
      returns base64 of a **PEM document**, not of DER (`normalizeSignature` / `normalizePublicKey`)
- [x] Cron for checking stale orders (releasing reservations) — `releaseExpiredReservations` in
      `workers/cron/`; same undeployed-Worker caveat as the Nova Poshta sync above
- [x] Configurable limit for cash on delivery — read from `settings.cod_limit` at checkout and
      enforced (`cod_over_limit`). Editing it from the admin panel is Phase 4's item, not this one
- [x] `/checkout/success` (for both the card and cash-on-delivery flows) and `/checkout/failure`
- [ ] Order confirmation emails to customers
- [x] Telegram notifications about new orders — `src/lib/notify/telegram.ts` implements `NotifierPort`
      against the Bot API. `orderCreated` fires from `createOrder` for both payment methods;
      `orderPaid` fires from the webhook route on the `paid` transition only, so a redelivered
      webhook (which `confirmPayment` reports as `unchanged`) cannot produce a second message. Both
      are sent outside the DB transaction and are best-effort by the port's contract — a Telegram
      outage never costs an order. Verified live in the manager group
- [x] Bot protection: Cloudflare Turnstile on the checkout form — `src/lib/turnstile/index.ts` calls
      siteverify from `POST /api/checkout` before any DB or cart work, and fails closed
- [x] Rate limiting on API routes — `src/middleware.ts` runs a per-IP, per-route fixed-window
      counter (`src/lib/rateLimit/`) against the `RATE_LIMIT` KV namespace, ahead of every route
      named in `docs/CONVENTIONS.md` (checkout, both NP search endpoints) plus `/api/cart` and
      `/api/checkout/limits`. `/api/webhooks/monobank` is deliberately excluded — it's already gated
      by `X-Sign`, and an IP bucket risks dropping a genuine redelivery from Monobank's own
      infrastructure. Budgets are sized to cost: `/api/checkout` (calls Turnstile + Monobank, creates
      a row) gets 5/5min, the debounced NP search inputs get 60/min. Verified live: tripped the limit
      on `/api/checkout/limits` (30/min) against the running dev server and got a 429 with a correct
      `retry-after`; confirmed the webhook keeps answering its own 403 rather than being rate-limited
- [x] ~~Delivery cost calculation~~ — **removed**, see the decision above. The recipient pays the
      carrier; nothing about delivery enters a total

Write tests alongside, not in Phase 5: order total calculation and webhook signature verification
are the two places where a bug costs money. The runner is **Vitest** (`pnpm test`), configured in
`vitest.config.ts` without the Astro config so a unit test never depends on the deploy target.
`src/lib/cart/index.test.ts` covers the first half of the order total: pricing from the database,
clamping to stock, and every way a stored cart can be malformed. `src/lib/monobank/index.test.ts`
covers the second, signature verification — with one lesson worth carrying into any future adapter:
its fixture originally stubbed the pubkey as DER, the same wrong assumption the implementation made,
so six green tests were confirming a broken path against itself. **A self-signed fixture cannot
validate a wire format** — stub the shape the real API actually returns.

## Phase 4 — Admin panel (2 days) — gate and orders done

The gate is live and the orders screens are finished — listing, managing and now creating. What
remains is the catalog side — products, content and image upload — plus the one-field
cash-on-delivery setting.

- [x] **The admin gate — the panel's own email/password login.** `src/lib/auth/` +
      `src/middleware.ts` gate `/admin/**` and `/api/admin/**`, fail-closed: PBKDF2 hashes in
      `admin_users`, a signed session cookie, and `pnpm admin:user` to manage accounts.
      **This replaced Cloudflare Access on 2026-08-05** (built first, and live behind one-time PIN
      for a day). Access worked; it did not travel — the panel is meant to be lifted into the next
      business, and a gate configured in one account's Zero Trust dashboard is not part of the code.
      What survived the swap is the property that mattered: the check runs inside the app, so it
      holds on every hostname the Worker answers on. There is no `pnpm dev` bypass any more — the
      form works locally, so the path that ships is the one exercised daily
- [x] **Managing orders** — `/admin/orders` (list: status filter, search over order number /
      customer name / phone, pagination) and `/admin/orders/[orderNumber]` (detail: line items,
      customer, delivery, the Monobank invoice row, the allowed status transitions, and the Nova
      Poshta tracking number). The state machine is pure and tested in `src/lib/orders/status.ts`;
      `updateStatus.ts` is the transactional half. Three properties worth keeping in mind before
      extending it: **`paid` is unreachable from the panel by construction** (a test asserts it over
      the whole enum — the webhook stays its only writer); **cancel and refund are never offered
      together**, since which one applies depends on whether money has actually been collected, so
      a cash order in transit is cancelled and a card order past `paid` is refunded; and **both
      return stock, but only when it was actually taken** — `confirmed`/`paid` and later have
      decremented and dropped their reservation, `pending`/`awaiting_payment` have only reserved.
      `refunded` is bookkeeping: nothing calls Monobank, the money is returned in its dashboard.
      The panel runs with no client-side JavaScript — GET forms for the view, POST + 303 for the
      writes, a `<details>` disclosure instead of a `confirm()`. Verified live against the dev DB,
      including both restock paths and four kinds of forged POST
- [x] **Creating an order from the panel** — `/admin/orders/new`. Added on request 2026-08-05, and
      **not in the original phase**: the case is a customer who orders in Telegram, where nobody
      ever opens the shop. It is a screen over the storefront's own `createOrder`, not a second
      order path — same repricing, same `FOR UPDATE` locking, same reservation, same state machine,
      so `paid` stays webhook-only and an oversell is refused with `cart_changed` exactly as at
      checkout. The draft lives in the form's own fields (`src/lib/orders/draft.ts`): every button
      is a submit, the server is a pure function of the body, and there is no draft stored anywhere
      — which is also what keeps a customer's name and phone out of URLs and Worker logs. Only the
      create submit redirects. Decisions taken: **both payment methods** (a card order
      shows the Monobank link to paste into the chat, and the 30-minute reservation window was
      accepted as-is — the link dies and the cron cancels the order), **no query-string state**,
      **no oversell**, and **the customer email fires but the manager's Telegram message does not**
      (`createNoopNotifier` — the manager is the notification). `payments.page_url` (migration
      `0005`) is what makes the link survive; `lastPayload` could not hold it, since every webhook
      overwrites that. The COD limit is enforced here too
- [ ] Managing products and content
- [ ] Image upload — POST the file to an admin route and call `storeImage`, the same code path
      `pnpm media:ingest` uses. Since nothing is resized server-side, the form has to state the
      expected dimensions and reject anything wildly off, or the storefront inherits whatever the
      uploader happened to export
- [ ] Configuring the cash-on-delivery limit — `settings.cod_limit` is already read and enforced at
      checkout (`getCodLimitKopiykas`); what is missing is the one screen that writes it

> **Not in this phase, and not agreed either way: telling the customer when an admin moves an
> order.** Marking an order shipped or cancelled currently sends nothing — Telegram and email fire
> on order creation and on payment, and nowhere else. Whether «Відправлено» / «Скасовано» should
> reach the customer is a decision about what the shop says to people, not a UI detail, so it is
> recorded here rather than built. Both adapters already implement `NotifierPort`, so the work is
> small once the answer exists; the answer is what is missing.

## Phase 5 — Launch (2–3 days)

- [ ] **Allow indexing** — `SITE_IS_INDEXABLE` in `src/layouts/BaseLayout.astro` is `false`, so every
      page ships `noindex, nofollow`. Flip it only once the legal pages exist and the domain is
      attached, or the store launches invisible
- [ ] Filling in content
- [ ] Testing
- [ ] Replacing the Monobank test token with the client's token
- [ ] **Migrate off the dev accounts** — a Neon project (EU Frankfurt) and a Cloudflare account owned
      by the client: run the migrations there, set every secret again, repoint Workers Builds, attach
      the domain. Development so far has run on personal accounts, so this is a full second setup,
      not a transfer. Only the schema and migrations carry over; the seed data does not
- [ ] Pick the Neon plan on that project — see the PITR note in Phase 0
- [ ] Training the client on the admin panel
- [ ] Analytics coverage
- [ ] Verify DB backups on the client's project

## Phase 6 — Improvements (as needed)

- [ ] SEO: sitemap, robots, JSON-LD, OG images
- [ ] Order export to CSV
- [ ] Admin action log
- [ ] Site multilingual support — post-launch; the header switcher was removed, so adding a language
      means reintroducing it together with English copy for every product and static page
- [ ] Email campaigns to customers (promotions, restocks, abandoned cart, etc.). The footer signup
      was removed for release, so this starts with collecting addresses at all — storage, a
      double opt-in and a consent record, not just a form
- [ ] Customer registration on the site, personal account (wishlist, browsing history,
      recommendations, reviews)

---

## Not yet placed in a phase

Raised during the Phase 1 review and still unowned:

- **Where the rest of the product photos come from, and at what size.** Three products are covered
  (see Phase 2); the remaining catalog is not. Since nothing is resized server-side, this now also
  means agreeing an export size with whoever prepares the shots — see the note below.
- **One file serves both the card and the gallery.** The test photography is 1440×1920 at
  ~200–700 KB, which is right for the product page and heavy for a grid card (~300 px on desktop,
  ~160 px on a two-column phone). The audience arrives from Instagram on a phone, so this is worth
  settling during the `/products` grid work: either the prepared exports get smaller, or a product
  gets a separately prepared card image — `product_images` already holds many rows per product, so
  it needs no schema change either way.
  **Still open after the grid shipped.** `/products` renders the same 1440×1920 files into ~135 px
  card slots on a 320 px phone, so a first view downloads roughly 2 MB of photography to paint
  thumbnails. Only the first two cards load eagerly, which limits the damage but does not fix it.
  Nothing about this is a code change — it is an agreement on export sizes, and then a re-ingest.
