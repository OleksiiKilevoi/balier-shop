# STATE — balier.ua

> Single source of truth for "where did we stop". Read aloud at session start.

## 📍 CURRENT STATE (overwrite this block; keep tight)

- **Last done:** fixed two real bugs reported live — (1) `/checkout/success` staying on "Очікуємо
  підтвердження оплати" forever even after real payment, (2) the cart never clearing after a
  successful order. Root cause of (1): last session's `webhookUrl` fix deliberately kept it pinned
  to `PUBLIC_SITE_URL` (`https://balier.ua`) instead of making it request-derived like
  `redirectBaseUrl` — reasonable-sounding at the time ("must stay a real reachable address"), but
  `balier.ua` doesn't actually resolve yet (confirmed via DNS lookup — it isn't deployed), so
  Monobank's webhook had nowhere real to land, ever, even when testing against the deployed
  `balier-dev.workers.dev`. Fixed by making `webhookUrl` request-derived too (`src/pages/api/checkout.ts`),
  same origin as `redirectBaseUrl` — confirmed with the user first since it reverses a prior
  deliberate decision on the money path. Plain `localhost` testing still needs a tunnel (Monobank
  can never reach `localhost` regardless of URL construction) — unchanged, same as before. Root
  cause of (2): `clearCart()` (`src/stores/cart.ts`) existed but was never called anywhere — added
  the call in `checkout.astro`'s submit handler right before the redirect on success.
  `pnpm check`/`pnpm test` (51/51)/`pnpm build` all pass. **Not verified live** — no browser
  automation available this session; worth a real card-payment run against the deployed dev Worker
  to confirm the webhook now actually lands and the success page flips to "paid" on refresh, plus a
  visual check that the cart badge/`/cart` empties after an order. All uncommitted (this and
  everything before it — nothing in `/checkout`'s whole build-out has been committed yet).
- **Also true (from the prior session, unchanged):** Phase 3's "core money path" —
  `/checkout` end to end, `src/lib/orders/`, `src/lib/monobank/` (`PaymentPort` incl. ECDSA
  signature verification), `src/lib/novaposhta/` (client + sync), the checkout/webhook API routes,
  `/checkout` + `/checkout/success` + `/checkout/failure`, and both cron jobs
  (`releaseExpiredReservations`, `syncNovaPoshta`) are real. Telegram order-created notifications
  (`src/lib/notify/telegram.ts`) are wired and verified live. Verified live against the real dev
  Neon DB: COD orders end to end, the strict `cart_changed` rejection rolling back with zero side
  effects, and — with real Monobank/Nova Poshta credentials from Mykhailo's personal dev accounts
  (see `balier-infra-accounts-are-dev` memory) — **card payment confirmed working end to end
  including the paid transition and idempotency** (order `B260804-6DN8Q`). Test orders
  `B260804-BYP3K`, `B260804-S86Y7` (COD) and `B260804-6DN8Q` (card, paid) are real rows in the dev
  DB, harmless, not cleaned up. **Still not verified:** the actual webhook HTTP *delivery*
  (Monobank calling back over the network, incl. real `X-Sign`) — no tunnel tool installed to
  expose `localhost`, and the deployed dev Worker still has the `DATABASE_URL` secret issue below.
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are real (see below).
- **In progress:** Phase 3. Deferred on purpose, per the reviewed plan: order-confirmation email,
  a Telegram `orderPaid` notification (the webhook still doesn't send one — only order creation
  does so far), general API rate limiting (needs the `RATE_LIMIT` KV namespace), the admin-editable
  cash-on-delivery limit (Phase 4; the seeded `settings.cod_limit` is read, not writable yet).
  Phase 2 still carries its own leftover: the seven static pages render a heading, a lead and a
  `ContentPlaceholder`. Writing them is a Phase 5 content item, and the legal ones gate Monobank.
- **Next step:** verify today's two fixes live — place a real card order against the deployed
  `balier-dev.workers.dev` and confirm the webhook now lands and `/checkout/success` flips to
  "paid" on refresh, and confirm the cart empties after checkout. Pure `localhost` webhook testing
  still needs a tunnel tool (`cloudflared`/`ngrok`) — unchanged. Otherwise, pick the next Phase 3
  item: the `orderPaid` notification or rate limiting.
- **Blockers (waiting on me):**
  - Phase 0 externals unchanged: Monobank Acquiring registration, Nova Poshta business account +
    cash-on-delivery setup, Telegram manager account / bot / chat.
  - `DATABASE_URL` must exist as an **encrypted Secret** on the `balier-dev` Worker. On
    2026-08-03 `wrangler secret list` returned `[]` and every DB-backed route 500ed. Local dev
    reads `.dev.vars` and works, so this only bites the deployed site.
    <!-- TODO: confirm whether this has since been set. -->
  - `PUBLIC_TELEGRAM_MANAGER` in `wrangler.jsonc` is a **placeholder handle**.
- **Active branch:** `main` (only branch; tracks `origin/main`). A push to `main` deploys.

## ✅ Phase tracker (high-level; detail in docs/plans/roadmap.md)

- [~] Phase 0 — Preparation (Neon + R2 done; Monobank, Nova Poshta, Telegram outstanding)
- [x] Phase 1 — Foundation (schema, migrations, seed, design components, deploy verified)
- [~] Phase 2 — Catalog / storefront (every page built; static-page copy outstanding)
- [~] Phase 3 — Cart and payment (cart, `/checkout`, both payment methods, webhook, both crons,
      Turnstile done; `orderPaid` notification, rate limiting, admin COD-limit editing still open)
- [ ] Phase 4 — Admin panel
- [ ] Phase 5 — Launch (incl. migrating off the dev Neon/Cloudflare accounts)
- [ ] Phase 6 — Improvements

---

## 🗒️ SESSION LOG (newest first; 3–6 lines each)

### 2026-08-04 — fix payment status never updating + cart not clearing

- Did, on report ("order is paid but /checkout/success still says awaiting confirmation, and the
  cart doesn't clear"): traced both to real bugs, not UI polling gaps. `webhookUrl`
  (`src/pages/api/checkout.ts`) was still built from `PUBLIC_SITE_URL` after last session's redirect
  fix — confirmed live that `balier.ua` doesn't resolve at all (not deployed), so Monobank's
  server-to-server callback had no real address to hit, ever; the order could never leave
  `awaiting_payment` no matter how long you waited or refreshed. Asked before changing it, since it
  reverses a deliberate call from last session: made `webhookUrl` request-derived (`new
  URL(request.url).origin`), same as `redirectBaseUrl`, confirmed with the user first. `clearCart()`
  existed in `src/stores/cart.ts` but had no caller anywhere — added the call in `checkout.astro`'s
  submit handler right before the success redirect.
- Decisions: pure `localhost` webhook testing still needs a tunnel tool — Monobank can't reach
  `localhost` regardless of URL construction, that constraint is unrelated to today's bug and
  unchanged. Testing against the deployed `balier-dev.workers.dev` should now work webhook-to-paid
  end to end without one, for the first time.
- Verified: `pnpm check`/`pnpm test` (51/51)/`pnpm build` all clean. **Not verified live** — no
  browser automation available this session, same recurring gap as most of `/checkout`.
- Next: a real card order against the deployed dev Worker to confirm the webhook lands and the
  success page flips to "paid" on refresh, and that the cart visibly empties after checkout.

### 2026-08-04 — fix redirect stuck on `balier.ua`

- Did, on request (couldn't test — every checkout redirected off to a site that doesn't exist yet):
  `CreateOrderDeps.siteUrl` was one value used for both the post-checkout browser redirect and the
  Monobank webhook URL, always `PUBLIC_SITE_URL` (`https://balier.ua`, hardcoded in `wrangler.jsonc`).
  Split into `redirectBaseUrl` (now `new URL(request.url).origin` in `/api/checkout.ts` — matches
  `localhost`, the `workers.dev` dev Worker, or eventually `balier.ua`, whichever the browser is
  actually on) and `webhookUrl` (unchanged, still `PUBLIC_SITE_URL`-derived — Monobank's server
  calls this, not the browser, so it can't be request-derived and still needs a real reachable
  address; unaffected by this fix, same tunnel blocker as before).
- Verified: `pnpm check` (0 errors)/`pnpm test` (51/51)/`pnpm build` all clean. Not yet re-verified
  live against the real dev server or the deployed dev Worker this session.
- Next: place a real COD order against `pnpm dev` and against the deployed dev Worker to confirm
  each redirects to its own `/checkout/success` correctly. Card-payment `paid` transition still
  needs a tunnel tool for the webhook, unchanged from before.

### 2026-08-04 — Turnstile on `/checkout`

- Did, on request: found a real widget already provisioned from a prior session (sitekey
  `0x4AAAAAAEF8vF0-cXNWdOOY` + secret, sitting in `.dev.vars`) and a `CaptchaPort` interface
  already declared in `ports.ts` waiting for an adapter — `docs/OVERVIEW.md` already documents the
  intended design ("Turnstile is validated on the server (siteverify) at checkout"). Given that,
  deviated from the generic turnstile-spin skill's default (new widget + a separate proxy Worker)
  and instead: `src/lib/turnstile/index.ts` (`createTurnstileCaptcha`, same adapter pattern as
  `src/lib/monobank/`) calls `challenges.cloudflare.com/turnstile/v0/siteverify` directly from
  `POST /api/checkout`, before any DB/cart work — fails closed (`captcha_failed`, 400) on a
  missing/invalid/unreachable-siteverify token, same best-effort-safe contract as the other ports.
  `checkoutRequestSchema` gained `turnstileToken`. `/checkout`'s form got the widget
  (`.cf-turnstile[data-sitekey]` + the external `api.js` script), reads the auto-populated
  `cf-turnstile-response` field into the submit payload, shows an inline error and calls
  `window.turnstile.reset()` on any non-redirect outcome so a retry gets a fresh token.
- Found and fixed a real gap along the way: `PUBLIC_TURNSTILE_SITE_KEY` only existed in gitignored
  `.dev.vars`, so it would have silently been empty in production. Moved it to `wrangler.jsonc`'s
  public `vars` (alongside `PUBLIC_SITE_URL`/`PUBLIC_TELEGRAM_MANAGER`) with the real value, and
  reran `pnpm cf-typegen` so it's typed. `.dev.vars`/`.dev.vars.example` updated to reflect that
  only `TURNSTILE_SECRET_KEY` is a secret now.
- Verified: `pnpm check`/`pnpm test` (51/51, 6 new)/`pnpm build` all clean. Live against the
  running dev server: `/checkout`'s HTML renders the widget with the real sitekey and loads the
  real `api.js`; a `POST /api/checkout` with a garbage `turnstileToken` round-tripped through the
  real Cloudflare siteverify API (real secret) and correctly came back `captcha_failed`, gating out
  before any DB/cart work ran. **Not verified:** an actual browser pass — completing a real
  Turnstile challenge and a full submit with a genuine token — no browser automation tool available
  this session either, same recurring gap as the rest of `/checkout`.
- Next: unchanged — the webhook HTTP delivery round-trip (needs a tunnel tool), or pick up the
  `orderPaid` notification / rate limiting.

### 2026-08-04 — Telegram order-created notifications

- Did, on request (bot/chat already set up, bot has message permissions in the group): implemented
  `NotifierPort` (already declared in `ports.ts`) with a real adapter, `src/lib/notify/telegram.ts`
  — `createTelegramNotifier(botToken, chatId)`, POSTs to the Bot API's `sendMessage`. Message
  includes order number, each line (title + colour, SKU, qty × price), total, payment method label,
  delivery method + destination (settlement + warehouse/postomat name, or settlement + street for
  courier), customer name/phone, and the comment if any — the manager's own working channel, not a
  log, so this is deliberately more than the "no PII in logs" rule covers. `orderPaid` is
  implemented too (the port requires both methods) but **not wired anywhere yet** — only
  `orderCreated` is called, from `src/lib/orders/create.ts`, once for cash-on-delivery (after the
  order lands `confirmed`) and once for card (after the Monobank invoice succeeds and the order
  lands `awaiting_payment`). Per the port's own contract (`ports.ts`) and `docs/OVERVIEW.md`
  ("Turnstile, Telegram, email"), `send()` catches everything internally and never throws — a
  Telegram outage can't fail checkout.
  `createOrder` changed shape to support this: the `order_items` insert and the order-status updates
  now `.returning()` so the real DB rows (not just the fields `create.ts` already tracked) go into
  the notification.
- Verified: `pnpm check`/`test` (45/45, 3 new — `notify/telegram.test.ts` covers the pure message
  formatter)/`build` all clean. Live, with the real `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` from
  `.dev.vars`: placed one real COD order and one real card order through the running dev server,
  then pulled each Telegram message back out with `forwardMessage` (the Bot API has no "read my own
  sent message" call) to confirm it actually reached the "Balier Notifications" group with correct
  Ukrainian text and Cyrillic intact end to end — orders `B260804-CHDCK` (COD) and `B260804-GRL8R`
  (card, real Monobank invoice). First attempt at this used inline Cyrillic in a shell `curl -d`
  argument and came out as `?????` in the delivered message — a Windows console encoding artifact
  in the test command itself, not an app bug; switching the test payload to a UTF-8 file fixed it,
  worth remembering for any future live-probing like this.
- Next: unchanged from before — the webhook HTTP delivery round-trip (needs a tunnel tool), or pick
  up Turnstile / the `orderPaid` notification / rate limiting.

### 2026-08-04 — `/checkout` input UX: phone mask, settlement ranking, warehouse search

- Did, on request (three concrete complaints about the existing inputs):
  - **Phone:** `src/lib/phone.ts` (new, tested) — `+380` is now a fixed prefix chip in the UI, the
    input only holds 9 local digits and auto-formats to `50 123 45 67` on every keystroke,
    cursor-position preserved. Handles a pasted/autofilled full number in any shape (`0…`, `380…`,
    `+380 …`) by normalising down to the same 9 digits. Submit blocks with a message if incomplete.
  - **Settlement search:** display format changed to `м. Шостка - Сумська обл.` (type abbreviation
    + name + **oblast**; was showing the raion before). Fixed "Ки" not surfacing "Київ" — added
    `np_settlements.warehouse_count` (migration `0002`, backfilled via `pnpm np:sync`) as a
    popularity proxy, since Nova Poshta's `getSettlements` has no population field but a real city
    has hundreds/thousands of warehouses and a village has 0–1 (confirmed live: Kyiv = 7 756).
    Also started populating the `type` column, which existed in the schema but nothing wrote to it
    before (`SettlementTypeDescription` from NP's `getSettlementTypes`, confirmed live: exactly 4
    values — місто/село/селище/селище міського типу → м./с./с-ще/смт). Search now orders by
    exact-prefix match first, then `warehouse_count` desc, then name.
  - **Warehouse/postomat picker:** was a plain unfiltered `<select>`. Live DB check found the real
    reason it needed to change beyond the ask: Kyiv alone has 7 756 warehouse rows, and the old
    `RESULT_LIMIT = 300` was silently truncating it with no way to reach the rest. Replaced with
    the same search-combobox pattern the settlement field already used — `listWarehouses` gained
    an optional `q` filter on `description` (branch number + address), `/api/checkout/np-warehouses`
    threads it through, default limit dropped to 50 since a query narrows it now.
- Decisions: verified every NP API/data assumption live against the real API and real dev-DB data
  (`.dev.vars`' real credentials from last session) before writing code, rather than guessing field
  names — e.g. confirmed `getSettlements` has no population field before committing to the
  warehouse-count proxy, and confirmed the exact 4 `getSettlementTypes` values before hardcoding
  the м./с./с-ще/смт abbreviation map.
- Verified: `pnpm check`/`test` (42/42, 8 new)/`build` all clean. Live against the real dev Neon DB
  and dev server (curl): `/api/checkout/np-settlements?q=Ки` now returns Київ first;
  `/api/checkout/np-warehouses?...&q=Хрещатик` filters correctly. **Not verified:** actual browser
  interaction — no browser automation tool available this session either, same gap as before.
- Next: a real browser pass on `/checkout` (all three widgets, 320px) is now the single highest-
  value unverified thing in this whole feature — nothing in `/checkout` has been eyeballed live yet.

### 2026-08-04 — `/checkout`: order creation, both payment methods, the webhook

- Did: built Phase 3's "core money path" end to end — see the CURRENT STATE block above for the
  full file list. Order creation locks and re-resolves the cart inside a `createTxDb` transaction
  (`FOR UPDATE` on the requested variants), refusing the whole order rather than clamping it if
  anything changed; cash on delivery commits (decrements stock, drops the reservation) immediately
  since there's nothing to wait on, card leaves the reservation live and calls Monobank *outside*
  the transaction, rolling the order back to `cancelled` if the invoice call itself fails. The
  webhook re-checks status via `invoice/status` (never trusts the webhook body) and is idempotent
  on an order that already left `pending`/`awaiting_payment`. Nova Poshta sync resolves warehouse
  types live (`getWarehouseTypes`) into a readable label rather than hardcoding a type-ref GUID, so
  `np_warehouse` vs `np_postomat` filtering needs no unverified constant.
- Decisions: scoped down from the roadmap's 12-item Phase 3 checklist by explicit agreement before
  building — Turnstile, notifications, rate limiting and the admin COD-limit UI are follow-up
  sessions, not part of this pass. Also added the stale-reservation cron beyond the original ask,
  flagged and accepted: a reservation TTL does nothing if nothing ever releases it.
- Verified: `pnpm check`/`test`/`build` all clean. Then live against the real dev Neon DB (the only
  real secret in `.dev.vars` right now) — two real COD orders placed end to end confirming the
  stock decrement and reservation cleanup, and the strict rejection path confirmed to leave zero
  side effects. Caught and fixed two real Nova Poshta field-name bugs this way (see CURRENT STATE).
  **Not verified:** the card/Monobank path and the Nova Poshta sync itself — `MONOBANK_TOKEN` and
  `NOVAPOSHTA_API_KEY` are still empty placeholders, and no browser pass was done on the page.
- Next: fill in real Monobank/NP credentials, run `pnpm np:sync`, do a real card-payment + webhook
  round trip, and open `/checkout` in an actual browser at 320px.

### 2026-08-03 — cart popup: show the stock-limit notice

- Did: the popup fetched `summary.notices` from `/api/cart` but never rendered them, so a customer
  repeatedly clicking «Додати до кошика» past what's in stock just saw the quantity stop climbing,
  with no explanation. Added the same `data-notices` list + `cartNoticeText()` rendering `/cart`
  already had, into `src/components/CartPopup.astro`, so a clamped or sold-out line now shows the
  same «у наявності лише N шт.» / «закінчився» copy the cart page shows.
- Decisions: reused `/cart`'s existing notice styling and copy verbatim rather than inventing
  popup-specific wording — one message for the same server-side event, wherever it's shown.
- Verified: `pnpm check` (0 errors) and `pnpm build` both pass. Not eyeballed live in a browser —
  worth triggering a clamp by hand (add past stock) before/along with `/checkout`.
- Next: unchanged — `/checkout`.

### 2026-08-03 — add-to-cart popup replaces the toast

- Did: on request, swapped the add-to-cart toast for a Rozetka-style cart popup — higher expected
  purchase conversion than a passive confirmation. `src/components/CartPopup.astro` (centered modal;
  no existing anchored-popover pattern to extend, and centered works unchanged at 320px and desktop),
  `src/lib/cartPopup.ts` (`openCartPopup()`, same event-dispatch shape the toast used). Opens on
  add-to-cart, fetches `/api/cart` fresh, lists every line (image, title, variant, qty × price), the
  total, and «Оформити замовлення» → `/checkout`, plus a link to `/cart`. Converges the store to the
  server's answer (`replaceCart`) on every open, same as `/cart` itself.
- Decisions: extracted the `/api/cart` fetch the popup needed into `src/lib/cart/client.ts` and
  pointed `/cart`'s own fetch at it too, rather than duplicating it — one fetch, one error path.
  Background content gets `inert` while the popup is open (same technique `SiteHeader`'s mobile nav
  already uses) instead of a hand-rolled focus trap; focus returns to the button that opened it.
  `src/lib/toast.ts` and `src/components/Toast.astro` deleted — nothing else referenced them.
- Verified: `pnpm check`, `pnpm build`, `pnpm test` all pass; traced the served module graph through
  the dev server to confirm the popup's script and the product page's `openCartPopup()` call both
  resolve with no import errors. No browser automation tool was available this session, so the
  open/close animation, focus return and backdrop dismissal have not been eyeballed live — worth a
  manual check before/along with `/checkout`.
- Next: unchanged — `/checkout`.

### 2026-08-03 — mobile menu polish

- Did: `SiteHeader.astro`'s mobile nav panel — was `hidden`/instant show-hide and pushed `<main>`
  down while open. Now: `absolute` against the sticky header (its containing block) so it overlays
  the page instead of growing the header's box; open/close animates via a `grid-rows-[0fr] → [1fr]`
  + opacity transition (300ms) instead of a display cut; `inert` toggled alongside so the collapsed
  links leave tab order without a `display: none` jump. Link text is centered (was left, briefly
  right, settled on center per direction mid-session).
- Verified: `pnpm check` passes (0 errors) after each edit. Not eyeballed live in a browser this
  session — worth a manual check on a real mobile viewport.
- Next: unchanged — `/checkout`.

### 2026-08-03 — add-to-cart toast

- Did: replaced the add-to-cart button's in-place «Додано ✓» label swap with a global toast —
  `src/lib/toast.ts` (`showToast()`, fires a `toast:show` DOM event) and `src/components/Toast.astro`
  (stacks, top-right, slide + fade in ~300ms, auto-dismisses ~2.6s, `role="status" aria-live="polite"`),
  mounted once in `BaseLayout.astro`. The product page now calls `showToast()` on add; the old
  sr-only `data-cart-status` region is gone since the toast's own live region covers that.
- Decisions: kept `showToast()` generic (not cart-specific) so any future action can reuse it.
- Verified: `pnpm check` and `pnpm build` pass; confirmed the rendered markup via `pnpm dev` + curl.
  No browser automation tool was available this session, so the slide/fade motion itself has not
  been eyeballed live — worth a quick manual check.
- Next: unchanged — `/checkout`.

### 2026-08-03 — Phase 3, part 1: the cart

- Did: `src/lib/cart/` (pure totals + clamping), `src/lib/validation/cart.ts`,
  `src/lib/db/queries/cart.ts`, `src/stores/cart.ts`, `POST /api/cart`, `/cart`, the header badge,
  and the product page's «Додати до кошика». Vitest added (`pnpm test`, 22 tests on the totals).
- Decisions: open decision 1 closed — the recipient pays Nova Poshta's tariff, so the site never
  quotes delivery and `deliveryTotal` is always 0. Adding keeps the customer on the product page and
  confirms in the button. `QuantityStepper` switched to delegated listeners so cloned cart rows work.
- Verified against Neon at 320 px and 1280 px: clamping, sold-out, malformed storage, a blocked
  `/api/cart` (error state + retry), and a burst of «+» collapsing into one revalidation.
- Next: `/checkout`. Its CTA on `/cart` 404s until then.

### 2026-08-03 — docs reorganization

- Did: created `docs/` (STATE / OVERVIEW / CONVENTIONS / plans), `git mv`'d `roadmap.md` to
  `docs/plans/roadmap.md`, and reduced `CLAUDE.md` to a router.
- Decisions: `roadmap.md` keeps its filename so the bare-filename references in source comments
  still read correctly; the file now lives at exactly one path.
- Next: continue with Phase 3, or correct anything mis-inferred in the block above.

### 2026-08-03 — Phase 2 build

- Did: homepage, `/products`, `/products/[slug]`, `/products/category/[slug]`, `/search`, `404`,
  seven static-page placeholders; R2 media pipeline and dev catalog ingest.
- Decisions: no EN/UA switcher, no newsletter signup, Telegram CTA is a plain deep link, images
  are never resized server-side. All recorded in `docs/plans/roadmap.md`.
- Next: Phase 3 (cart, checkout, Monobank webhook).
  <!-- TODO: confirm — this entry is reconstructed from commits and the roadmap, not written live. -->
