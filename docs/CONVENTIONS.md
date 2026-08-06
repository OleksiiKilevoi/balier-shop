# CONVENTIONS — balier.ua

> Rules to always follow. Architecture and integration detail live in `docs/OVERVIEW.md`;
> the three everyday commands and the top hard rules live in `CLAUDE.md`.

## Environment

Package manager is **pnpm**, pinned to the major in `packageManager` — do not run `npm install` /
`yarn`, and do not drop that field. See the `pnpm-workspace.yaml` trap in `docs/OVERVIEW.md`.

The everyday commands (dev server, the pre-done gate, deploy) are in `CLAUDE.md`. Everything else:

```bash
pnpm preview          # serve the build in workerd via wrangler
pnpm cf-typegen       # regenerate worker-configuration.d.ts after editing wrangler.jsonc
pnpm db:generate      # drizzle-kit generate — SQL migration from the schema (works offline)
pnpm db:migrate       # apply migrations (needs DATABASE_URL)
pnpm db:studio        # drizzle studio
pnpm db:seed          # populate with development data (idempotent)
pnpm media:ingest     # upload test-products/ to the LOCAL R2 + write the seed manifest
pnpm media:push       # copy those objects to the REAL bucket (dev convenience, needs login)
pnpm cron:dev         # run the cron worker locally with --test-scheduled
pnpm cron:deploy      # deploy the cron worker
pnpm test             # vitest, one run
pnpm test:watch       # vitest, watching
```

The dev server is daemonised: `pnpm astro dev stop` / `logs` / `status`.

Tests are **Vitest**, added in Phase 3 and living next to what they test (`*.test.ts` under `src/`).
`vitest.config.ts` deliberately does not load the Astro config: what is worth testing is pure domain
code in `src/lib/`, and a unit test should not depend on the deploy target. Order total calculation
and webhook signature verification are the two places where a bug costs money — those get tests
first, and anything touching either is expected to arrive with them.

## Git

Observed style, from the whole history so far:

- Lowercase imperative subject, no scope prefix, no trailing period —
  `add /products/category/[slug]`, `disable indexing`, `fix pnpm v mismatch`.
- Subject only; no bodies in use.
- Work happens directly on `main`, which is also what Cloudflare Workers Builds deploys from.
  A push to `main` is a deploy.
- Ask before destructive git operations (force-push, history rewrite, branch deletion).

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
- `products.dimensions` is free text exactly as written on the card (`30х17х10 см`), not structured
  numbers — the wallet has two dimensions and the bags have three.
- The variant selector is hidden in the UI when a product has a single variant. That is a rendering
  decision only — it changes nothing in the data model or the checkout logic.

### Images

Product photography lives in the **`balier-media` R2 bucket** (`MEDIA` binding) and is served by
`src/pages/media/[...key].ts`.

- **Images are prepared at the right size before upload. We do not resize.** One uploaded file is
  one stored object is one URL. `/media/**` is a byte pump; see the transformation-billing note in
  `docs/OVERVIEW.md`.
- **Keys are content hashes**, so objects are immutable and `/media/**` ships
  `max-age=31536000, immutable`. Replacing a photo produces a new URL; nothing is ever invalidated.
- **`product_images.url` is a site-relative path** (`/media/<hash>.<ext>`), never an absolute URL.
  Build it with `mediaUrl` from `src/lib/media`. This is what keeps the Phase 5 move to the client's
  account from touching a single database row.
- **Never link the bucket's public `r2.dev` URL.** Cloudflare rate-limits it and documents it as
  unsuitable for production.
- Accepted formats are the keys of `MEDIA_FORMATS` (webp, avif, jpg, png). Anything else is rejected
  at upload and 404s on the way out.
- `pnpm media:ingest` seeds the dev catalog from `test-products/` against the **local** R2
  simulator, so it needs no Cloudflare login. `test-products/` is gitignored — imagery belongs in
  R2, not the repository.

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
  fetched from Google at runtime. Cyrillic subsets are mandatory. **Only the display face is
  preloaded** — adding `preload` to more families pushes competing requests ahead of the LCP
  heading. Pin `weights` and `styles` to what is actually painted, or Astro ships italic and unused
  weights. (The `cssVariable` trap is in `docs/OVERVIEW.md`.)
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

## Admin panel

Build out of `src/styles/admin.css`'s utilities (`admin-btn*`, `admin-icon-btn`, `admin-field`,
`admin-select`, `admin-textarea`, `admin-card`, `admin-badge`, `admin-tone-*`). A storefront token
under `/admin` compiles to nothing — the panel's stylesheet is `source(none)` — and for the same
reason **a new panel component must live in `src/components/admin/`**. Colours go in as
`light-dark()` pairs on a token; nothing reads `prefers-color-scheme` directly, or it ignores the
theme switch.

**A panel screen may not reload itself to answer a save.** Every screen is plain
`<form method="post">` blocks answered with a 303, which must keep working with script off — but a
reload throws the page away and scrolls to the top, so a manager who pressed «Зберегти» three
screens down lands on the header and never sees the banner they were sent. The fix is written once,
in `src/lib/admin/forms.ts`; a screen wires it up rather than reimplementing it:

- one element with an `id` around everything a save can change (the swapped `root`);
- `data-form="<unique>"` on each form, so focus can find its button again after the swap;
- the server's banner rendered with an `id` and `data-tone="ok" | "bad"` — script moves that same
  `<p>` into a fixed `.admin-toast-host` div, a confirmation expires, a refusal waits to be
  dismissed. **There is no toast component and no second copy of the message**: the tone, the
  wording and the markup stay the server's, and the scriptless page shows the identical `<p>` in
  the flow of the page.

`/admin/orders/new` is the one screen that does not use it, and deliberately: it is a single draft
form that re-renders as it is typed into, so it debounces, abandons in-flight renders for newer
ones, and guards only the create submit. Its script is the ancestor of the shared module, not a
duplicate to be merged.

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

## Safety

- Secrets live only in `wrangler` secrets / Cloudflare environment variables. Never in the
  repository, never in chat, never in the client bundle. Public keys get the `PUBLIC_` prefix.
- A secret must be an **encrypted Secret**, never a plaintext dashboard variable — see the incident
  in `docs/OVERVIEW.md`.
- `/admin/**` and admin APIs are gated **inside the app** (`src/middleware.ts`), by a signed session
  cookie minted from the panel's own login form against `admin_users`. Never rely on edge
  configuration for this: the Worker is reachable on more hostnames than any edge policy covers.
  Unconfigured means deny. Passwords are PBKDF2 via Web Crypto (`src/lib/auth/`) — never plaintext,
  never a home-made hash, never a Node crypto import.
- **Account state is read from the database on every request, never taken from the session cookie.**
  The cookie is signed, which proves it is ours and unedited — it proves nothing about whether the
  account still wants it. So the gate (`apps/admin/src/middleware.ts`) calls `findActiveAdminById`
  on every request it lets through and checks `sessionStillValid`: a disabled account and a token
  older than that account's `sessions_valid_from` are both turned away on the next request. The row
  is passed to the page in `locals.adminUser`, so a screen that needs the role or the password hash
  does not read it twice.
- **Anything that invalidates a password or an account bumps `sessions_valid_from`** — a password
  change, an admin resetting somebody's password, and an account being switched off *or back on*
  (re-enabling without the bump would resurrect the tokens that were live when it went off).
  A role change does not: it is not a reason to sign anybody out. A silent rehash at login does not
  either. That column is the whole of revocation; there is no session table.
- Rate limiting on all public API routes (checkout, search, order creation).
- Do not log PII (phone, address, full name) or tokens. Telegram order notifications carry the
  minimum data needed.
- Ask before destructive operations: dropping tables, force-pushing, deleting files.

## What not to do

- Do not set an order to `paid` anywhere except the webhook handler.
- Do not trust prices, totals, or stock coming from the client.
- Do not reference `productId` from a cart item, order item, or reservation — always `variantId`.
- Do not use Node-specific APIs or `process.env` at runtime.
- Do not add dependencies incompatible with the Workers runtime (native modules, heavy SDKs).
- Do not expand a phase's scope from `docs/plans/roadmap.md` without discussion — the timeline is
  tight (~2 weeks).
