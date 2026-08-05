# HISTORY — balier.ua session log (archive)

> Split out of `docs/STATE.md` on 2026-08-05, when that file passed 1 200 lines and was being
> read in full at every session start. **Nothing here was rewritten** — these are the original
> entries, newest first, covering everything up to the end of Phase 3.
>
> Not loaded automatically. Read it when you need the reasoning behind something already built:
> the Phase 2 storefront, the cart, `/checkout`, both payment methods, the Monobank webhook,
> Turnstile, Telegram, the order-confirmation email, and the bugs each of those cost.
>
> Phase 4 onwards stays in `docs/STATE.md`. Move entries here once a phase is finished.

### 2026-08-04 — order-confirmation email

- Did, on request (after upgrading Cloudflare to Workers Paid specifically for this — Email
  Sending isn't on Free): `src/lib/notify/email.ts` implements the existing `NotifierPort`
  interface against the new `send_email` binding, rather than inventing a new port type — the
  shape (`orderCreated`/`orderPaid`, best-effort, never throws) already fit. Wired at the exact
  same three call sites `telegram.ts` uses: both branches of `createOrder` (`CreateOrderDeps`
  gained an `email` field) and the webhook's `paid` transition. Extracted the label maps and
  `deliveryDestination` both adapters need into `src/lib/notify/format.ts` so they share one copy
  instead of two.
- Decisions, both closed by asking rather than guessing: **(1)** card orders only email on
  `orderPaid`, not `orderCreated` — COD is genuinely confirmed at creation (same call site as
  Telegram's «Нове замовлення»), a card order isn't confirmed until Monobank actually reports
  success, and emailing "confirmed" before that would be wrong. The branching lives inside the
  email adapter itself, so `create.ts`'s call sites stay identical to Telegram's. **(2)** no domain
  is onboarded (`wrangler email sending list` is empty; `balier.ua` isn't on this Cloudflare
  account yet) and user chose to hold off rather than onboard a throwaway personal domain — so
  `ORDER_EMAIL_FROM` is set to the real `noreply@balier.ua` in `wrangler.jsonc`, and sending fails
  closed with `E_SENDER_NOT_VERIFIED` (caught, logged, never thrown into checkout) until
  `wrangler email sending enable balier.ua` is eventually run against whichever account holds that
  zone. Nothing about the code depends on which account that ends up being.
- Verified: `pnpm check` (0 errors)/`pnpm test` (74/74, 8 new)/`pnpm build` clean; the dev server
  boots cleanly with the new `EMAIL: SendEmail` binding. **Not verified live** — `/api/checkout` is
  gated by the real Turnstile secret, which curl can't satisfy, so placing a real COD order with an
  email address (to watch the send attempt and its graceful failure) needs an actual browser pass,
  same recurring gap as the rest of `/checkout`.
- Next: a real browser checkout pass, or start Phase 4 — Phase 3 is code-complete.

### 2026-08-04 — API rate limiting

- Did, on request: `src/lib/rateLimit/index.ts` (`checkRateLimit`, tested) is a KV fixed-window
  counter — `${key}:${windowStart}` holds a count, TTL'd to `windowSeconds * 2` so a slow reader
  never resurrects an expired window. Not atomic (KV has no increment primitive), so two requests
  racing the same window can both slip a step past the limit — accepted as fine for abuse
  deterrence, not fine for anything that has to bill on the count, and said so in the code comment.
  `src/middleware.ts` (new) applies it per-IP (`cf-connecting-ip`) ahead of a small route table:
  `/api/checkout` (5/5min — it calls Turnstile and Monobank and creates a row), `/api/cart` and
  `/api/checkout/limits` (30/min), the two NP search endpoints (60/min — debounced keystrokes).
  `/api/webhooks/monobank` is deliberately not in the table: `X-Sign` already gates it, and an IP
  bucket risks dropping a genuine redelivery from Monobank's own infra rather than an attacker.
- Decisions: created only the `RATE_LIMIT` KV namespace, not `CACHE` too, even though the roadmap
  checklist bundled them into one line — nothing needs `CACHE` yet, and creating unused
  infrastructure isn't in scope for "do rate limiting." Split that checklist line into two so the
  distinction survives. Also found and fixed along the way: `balier-cron` **is now deployed**
  (confirmed via `wrangler secret list --name balier-cron`, no longer "Worker not found") — that
  happened earlier in this session, before this pass, and the docs hadn't caught up to it yet.
- Verified: `pnpm check` (0 errors)/`pnpm test` (58/58, 4 new)/`pnpm build` clean. Live against the
  running dev server: `/api/checkout/limits` returns 429 with a correct `retry-after` after 30
  requests in a minute, and `/api/webhooks/monobank` keeps answering its own 403 across repeated
  calls rather than ever hitting the rate limiter — confirms the exclusion actually takes effect,
  not just that the code compiles.
- Next: the order-confirmation email — the only Phase 3 item left open.

### 2026-08-04 — the `orderPaid` Telegram notification

- Did, on request: wired the half of `NotifierPort` that had been implemented since the notifications
  session but called from nowhere. `confirmPayment` now `.returning()`s the row it just flipped to
  `paid` and hands it back in the result (`{ transitioned: 'paid'; order; items }`, items reused from
  the `findPaymentByInvoiceId` join rather than re-read); the webhook route sends «Оплачено» on that
  result and only that result.
- Decisions: the send lives in the route, not in `confirmPayment`, so it happens **outside** the
  transaction — same rule `create.ts` follows for the Monobank call, a network call must never hold a
  DB transaction open. Returning the order instead of notifying in place is what makes that possible.
  Duplicate protection needs nothing new: `confirmPayment` was already idempotent, so a redelivered
  webhook lands on `unchanged` and simply never yields a second `paid` result to notify from. Used
  `waitUntil` rather than `await` — Monobank wants a fast 200 and the notifier is best-effort by the
  port's contract anyway.
- Verified: `pnpm check` (0 errors)/`pnpm test` (54/54)/`pnpm build` clean, then live — deployed and
  confirmed the «Оплачено» message arrives in the manager group on a real card payment. The two new
  tests are the first to cover the *adapter* rather than the pure formatter (the wire call, and that
  a fetch failure resolves instead of throwing) — worth having, since "never throws into checkout" is
  a contract claim that a formatter test can't check.
- Next: deploy `balier-cron` (still never deployed), then rate limiting / the confirmation email.
- Also: brought `docs/plans/roadmap.md`'s Phase 3 checklist back in line with reality — it still had
  ten items unticked that have been built and verified since (checkout, both payment methods, the
  webhook, both crons, success/failure, notifications, Turnstile, the COD limit).

### 2026-08-04 — live on the deployed Worker: captcha always failing, then the webhook always 403ing

- Did, on report from live testing against `balier.mlosko.dev` ("captcha
  keeps failing, submit stays on the page"): two independent bugs, both invisible to local testing.
  - **`captcha_failed` on every submit** — the deployed Worker had no runtime `TURNSTILE_SECRET_KEY`.
    Chased a false trail first (dashboard showed all six secrets, `wrangler secret list` showed one;
    suspected a second Cloudflare account, since the wrangler login differs from the Claude login).
    The wider dashboard screenshot settled it: that table sits **inside the Build section** — those
    are Workers Builds *build-time* variables, not runtime bindings, which is why a redeploy also
    changed nothing (`wrangler deploy` preserves runtime secrets, and there was only ever one to
    preserve). Set all five properly with `wrangler secret put`. Ruled out a wrong secret first by
    probing siteverify directly with the `.dev.vars` value: `invalid-input-response`, meaning
    Cloudflare accepted the secret and rejected only the dummy token.
  - **Order then stuck at `awaiting_payment` despite real payment** — `invoice/status` said
    `success` while our `payments` row said `created`. The endpoint was reachable (an unsigned probe
    returned 403, so routing was fine), which pointed at signature verification rejecting a genuine
    webhook. Root cause: `GET /pubkey` returns `key` as base64 of a **PEM document**, not of DER —
    decoded, byte 0 is `0x2d` (`-`). Feeding that to `importKey('spki', …)` threw, `verifyWebhook`'s
    `catch` turned the throw into "invalid", and the handler answered 403. Every webhook, always,
    since the code was written. Fixed with `normalizePublicKey`.
- Decisions: the six existing monobank tests passed the whole time because `stubPubkeyFetch`
  exported the key as DER — the fixture encoded the same wrong assumption as the implementation, so
  the suite checked a broken path against itself. Changed the stub to PEM (the real shape) and added
  a bare-DER case for the passthrough, so the test now constrains reality rather than agreeing with
  the code. The generic lesson worth keeping: *a self-signed fixture cannot validate a wire format* —
  every local check of this path (garbage token, self-generated keypair) returns the same answer
  whether the format assumption is right or wrong.
- Verified: `pnpm check` (0 errors)/`pnpm test` (52/52, 1 new)/`pnpm build` clean; the real Monobank
  pubkey confirmed to import and reach `crypto.subtle.verify` (it previously never got that far).
  Then live, the real thing: card order `B260804-DAMN7` → `paid`, payment row `success`. First
  completed webhook round trip in the project's history, and it retires the "DER or raw `X-Sign`?"
  unknown that `src/lib/monobank/index.ts`'s header comment had been carrying.
- Also found, not fixed: `balier-cron` has never been deployed at all — see Next step. Earlier test
  order `B260804-XGYJ5` is genuinely paid at Monobank but sits at `awaiting_payment` (its webhook
  predates the fix and no retry landed); left alone deliberately, since only the webhook handler may
  mark an order paid (`docs/CONVENTIONS.md`).
- Next: deploy `balier-cron` with its own runtime secrets, then `orderPaid` / rate limiting.

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
  - **Settlement search:** display format changed to `м. [Місто] - [Область] обл.` (type abbreviation
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
