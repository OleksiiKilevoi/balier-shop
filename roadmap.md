# Online Store Development Plan

Estimate: ~2 weeks of build time, plus Phase 0 waiting on third parties.

Status legend: `[x]` done · `[~]` partially done · `[ ]` not started · `[?]` blocked on a decision

---

## Open decisions

These come from the mockups in `/design` contradicting or extending the plan below. Each one
changes scope, so they are recorded here rather than guessed at. Nothing downstream is built on
an assumed answer.

1. **Delivery cost.** The cart mockup shows "Нова Пошта — за тарифами перевізника", i.e. the
   customer pays the carrier and the site never quotes a price. If confirmed, this removes delivery
   quoting, per-product weight/dimensions, and delivery cost in the order total from Phase 3 — and
   means Monobank is only ever charged for goods.
2. **"Замовити через Телеграм" on the product page.** A second ordering path parallel to checkout
   that bypasses cart, stock reservation and payment. Is it a plain deep link with the product
   prefilled, or does it create a real order record?
3. **Newsletter signup in the footer.** A Phase 6 item that appears at launch in the mockups.
   Currently rendered but non-submitting — no endpoint, no storage. Carries consent obligations
   worth handling deliberately.

### Decided

- **EN/UA language switcher — removed.** English is not planned for release, so the toggle shown in
  the mockups is gone from the header (2026-08-03). The site ships Ukrainian only; i18n stays in
  Phase 6 and the DB translation tables stay in the schema, unused for now.

---

## Phase 0 — Preparation

External dependencies with real waiting time. Start these in parallel with Phase 1 — they are on
the critical path and nothing here is under our control.

- [ ] Register for Monobank Acquiring
- [ ] Nova Poshta API (NP account, business account), configure cash on delivery, decide who pays
      the transfer commission
- [ ] Neon project, EU Frankfurt — **blocks `db:migrate` and `db:seed`**
- [~] Cloudflare account — done, deploying through Workers Builds (dashboard, not CLI). Secrets are
      still unset; nothing reads one yet, so this no longer blocks a deploy
- [ ] Telegram: manager account for the deep link, bot and chat for notifications
- [ ] Confirm Neon plan covers the backup/PITR window we need (moved up from Phase 5)

## Phase 1 — Foundation (2–3 days) — done

- [x] Create the repository: astro, typescript, wrangler, drizzle
- [x] DB schema and initial migration (`migrations/0000_late_omega_flight.sql`), seed script
      — migration and seed cannot be *run* until the Neon project exists
- [x] Reusable design components: `Container`, `Button`, `Price`, `ProductCard`, `Breadcrumbs`,
      `SiteHeader`, `SiteFooter`
- [x] Types and ports (`src/lib/ports.ts`): payment, shipping, notifier, captcha
- [x] Base page layout, design tokens, self-hosted Cyrillic fonts
- [x] Build verified (`pnpm check` + `pnpm build`), homepage renders
- [x] Verify a real deploy — live at `balier-dev.mykhailoshulezhko.workers.dev`, deployed by
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

## Phase 2 — Catalog, storefront (3 days)

Full mockups exist for every page here, so there is little left to design.

- [ ] Homepage — replace placeholder sections with featured products from the DB
- [ ] `/products` page — breadcrumbs, product count, 4-column grid
- [ ] `/products/[slug]` page — gallery with thumbnail strip, category pill, description,
      dimensions block, quantity stepper, add-to-cart + Telegram CTAs (see open decision 2)
- [ ] Product search (the header search icon currently points at a nonexistent `/search`)
- [ ] Static pages: `/about`, `/care`, `/delivery`, `/returns`, `/contacts`, `/offer`, `/privacy`
      — all currently 404 and linked from the header and footer.
      **The legal ones are a hard gate for Monobank approval, not decoration.**
- [ ] Mobile layout

## Phase 3 — Cart and payment (3 days — realistically 5–6)

The heaviest phase by a wide margin. Consider splitting notifications out.

- [ ] Cart (nanostores + persist), server-side validation of prices and stock before checkout
- [ ] `/cart` page
- [ ] `/checkout` page
- [ ] Create the KV namespaces (`CACHE`, `RATE_LIMIT`) and uncomment the bindings in `wrangler.jsonc`
- [ ] Cron for syncing Nova Poshta reference data — handler stubbed in `workers/cron/`
- [ ] Payment methods: card / cash on delivery
- [ ] Webhook handler: X-Sign verification, idempotency, re-check via invoice/status, transition the
      order to paid
- [ ] Cron for checking stale orders (releasing reservations) — handler stubbed in `workers/cron/`
- [ ] Configurable limit for cash on delivery
- [ ] `/checkout/success` (for both the card and cash-on-delivery flows) and `/checkout/failure`
- [ ] Order confirmation emails to customers
- [ ] Telegram notifications about new orders
- [ ] Bot protection: Cloudflare Turnstile on the checkout form
- [ ] Rate limiting on API routes
- [?] Delivery cost calculation — see open decision 1; may be removed entirely

Write tests alongside, not in Phase 5: order total calculation and webhook signature verification
are the two places where a bug costs money.

## Phase 4 — Admin panel (2 days)

- [ ] Cloudflare Access, plus a server-side check of the Access JWT in the app itself
- [ ] Managing orders, products, content
- [ ] Configuring the cash-on-delivery limit

## Phase 5 — Launch (2–3 days)

- [ ] **Allow indexing** — `SITE_IS_INDEXABLE` in `src/layouts/BaseLayout.astro` is `false`, so every
      page ships `noindex, nofollow`. Flip it only once the legal pages exist and the domain is
      attached, or the store launches invisible
- [ ] Filling in content
- [ ] Testing
- [ ] Replacing the Monobank test token with the client's token
- [ ] Training the client on the admin panel
- [ ] Analytics coverage
- [ ] Verify DB backups (setup moved to Phase 0)

## Phase 6 — Improvements (as needed)

- [ ] SEO: sitemap, robots, JSON-LD, OG images
- [ ] Order export to CSV
- [ ] Admin action log
- [ ] Site multilingual support — post-launch; the header switcher was removed, so adding a language
      means reintroducing it together with English copy for every product and static page
- [ ] Email campaigns to customers (promotions, restocks, abandoned cart, etc.)
      — see open decision 3
- [ ] Customer registration on the site, personal account (wishlist, browsing history,
      recommendations, reviews)

---

## Not yet placed in a phase

Raised during the Phase 1 review and still unowned:

- **Product image hosting.** R2, Cloudflare Images, or committed assets? Needed before Phase 2 can
  show real products.
- **Where product photos come from.** The mockups use lifestyle shots from Instagram; someone has to
  crop them to the square card ratio.
