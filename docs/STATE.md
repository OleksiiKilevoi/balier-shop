# STATE — balier.ua

> Single source of truth for "where did we stop". Read aloud at session start.

## 📍 CURRENT STATE (overwrite this block; keep tight)

- **Last done:** **status revert on `/admin/orders/[orderNumber]`**, on report that a wrong click
  was unrecoverable — done in two passes in the same session, the second widening the first after
  a direct follow-up ask. `src/lib/orders/status.ts` gained `revertTarget(order)` (one step back, or
  `null`) and `revertCrossesPayment(order)` (does the step change whether money counts as
  collected); `allowedTransitions` now returns `[forward, back, exit].filter(...)` instead of
  `[forward, exit]`.
  - **Revert reaches `shipped → packed`, `delivered → shipped`, and — as of the second pass —
    `packed → paid` (card) / `packed → confirmed` (cash on delivery).** The first pass stopped at
    `packed`, reasoning that `paid`/`confirmed` are hard-off-limits (`docs/CONVENTIONS.md` hard rule
    2: `paid` is the webhook's alone; `confirmed` is `create.ts`'s). Asked to extend it to
    `packed → paid` anyway. The extension is still safe against that same rule, not an exception to
    it: `FORWARD` maps only `paid` and `confirmed` to `packed` and nothing else does (confirmed by
    grepping for any other write of `status: 'packed'` — there is none), so an order sitting at
    `packed` necessarily passed through the one matching its payment method already. Reverting to it
    restores a status the order demonstrably already held — a card order was verified paid by the
    real webhook to get there — rather than the panel independently declaring one paid, which is the
    thing hard rule 2 actually forbids. `revertTarget` picks the target by `paymentMethod` for
    exactly this reason, so a cash order can never land on `paid` nor a card order on `confirmed`
    (both directions verified live and unit-tested).
  - **No stock or reservation ever moves on any revert.** `confirmed`/`paid`/`shipped`/`packed`/
    `delivered` are all in `STOCK_COMMITTED`; moving among them doesn't touch `updateOrderStatus`'s
    `undoing` branch at all (still keyed on `next === 'cancelled' || next === 'refunded'`, unchanged)
    — so `updateStatus.ts` needed no edit for this feature at all.
  - **Two informational notes, both conditional.** `ORDER_REVERT_PAYMENT_WARNING` shows only when
    `revertCrossesPayment` is true — in practice only cash on delivery leaving `delivered`, since
    money lands for COD on hand-off and nowhere else, so stepping back flips the exit button that
    follows from «Повернено» to «Скасувати». `ORDER_REVERT_HINTS.paid` shows only on the `paid`
    target, clarifying the button doesn't call Monobank — added because that's the one label where
    "restoring a record" could be misread as "taking an action."
  - Rendered as its own secondary-styled button (not inside the `<details>` disclosure the terminal
    actions use) — undoing a click is corrective, not destructive, so it doesn't need the extra gate.
    `ORDER_REVERT_LABELS` in `i18n/admin.ts` gives every revert target its own verb copy rather than
    reusing `ORDER_TRANSITION_LABELS`, since the same status reads as *progress* from the forward
    button and as *undo* from this one.
  `pnpm check` (0 errors)/`pnpm test` (105/105, 8 new)/`pnpm build` clean, both passes. Verified live
  against the real dev Neon DB, both passes, on `B260804-DAMN7` (card): first pass — reverted
  `delivered → shipped → packed` (offered no further revert there at the time), forged
  `packed → paid` refused, walked forward back to `delivered`. Second pass — walked back down to
  `packed` again, forged the *other* payment method's target (`packed → confirmed` on this card
  order) and confirmed it's still refused, then did the real `packed → paid` revert, confirmed `paid`
  itself offers no further revert, and walked forward again to restore `delivered`. No stock change
  at any step in either pass.
- **Before that:** **the admin orders screen — Phase 4's second item.** `/admin/orders` (list) and
  `/admin/orders/[orderNumber]` (detail), behind the gate below, with the status transitions the
  order state machine allows and the Nova Poshta tracking number.
  - **The state machine is a pure module, `src/lib/orders/status.ts` (13 tests).** Everything about
    *what may happen* lives there; `src/lib/orders/updateStatus.ts` is thin transactional plumbing
    around it. Two rules carry the weight:
    - **`paid` is never a legal target.** `allowedTransitions` cannot produce it from any state,
      either payment method, and a test asserts that over the whole enum — the webhook stays the
      only writer (hard rule 2). A hand-crafted `POST … next=paid` was tried live and refused.
    - **Cancel and refund are decided by whether money has actually arrived**, not offered side by
      side. Card collects up front, so it is refundable from `paid` on; cash on delivery collects
      when the carrier hands the parcel over, so a cash order in transit is *cancelled* — there is
      nothing to refund yet. Exactly one of the two is ever offered.
  - **Both undo actions return stock, but only when it was actually taken** (decided by explicit
    ask). `confirmed`/`paid` and later have already decremented `product_variants.stock` and dropped
    their reservation (`create.ts` for cash, `confirmPayment.ts` for card); `pending`/
    `awaiting_payment` hold a live reservation and have decremented nothing. So undoing the first
    kind increments stock back, undoing the second only releases the reservation. Both paths were
    verified against the real dev DB, not just reasoned about — see below.
  - **`refunded` is bookkeeping, not a refund.** Nothing here calls Monobank; the money is returned
    in Monobank's own dashboard and the button says so, rather than implying it moves money.
  - **The panel runs with no client-side JavaScript at all.** Filter and search are a plain GET
    form (the URL carries the view, like `/search`); both writes are form POSTs back to the same
    page, answered with a 303 to it, so a refresh after acting re-reads instead of re-firing.
    Terminal actions sit behind a `<details>` disclosure rather than a `confirm()` — two deliberate
    clicks, no script. Each transition form carries the status it was *rendered* from, re-checked
    against the live row under `FOR UPDATE`, so a stale tab cannot fire a transition nobody chose.
  - **Astro's origin check already protects these forms**: a POST without a matching `Origin` header
    is refused with «Cross-site POST form submissions are forbidden» before any handler runs. Found
    by curl getting a 403 — worth knowing for any future admin form, and it means the panel's writes
    carry CSRF protection we did not have to build.
  - Also added: `src/lib/validation/admin.ts` (zod, incl. the 14-digit TTN — spaces and dashes
    stripped, empty clears it), `src/lib/i18n/admin.ts`, `src/components/admin/OrderStatusBadge.astro`,
    a nav row in `AdminLayout`, and `src/lib/db/queries/like.ts` — the LIKE-escaping helper that was
    private to `products.ts`, now shared by both search paths so the escaping rule has one definition.
  - **Three real bugs, all found by testing live rather than by the type checker:**
    - **The phone search matched stray digits.** `q=DAMN7` returned six orders, because the query's
      digits (`7`) were matched against every phone number. The phone clause now only runs on a
      phone-shaped query (digits and phone punctuation only, ≥3 digits).
    - **The item-count column was always `0`.** Drizzle renders column references **unqualified
      inside a `select` field** — `where "order_id" = "id"` instead of
      `"order_items"."order_id" = "orders"."id"` — so the correlated subquery compared `order_items`
      to itself and summed nothing, with no error anywhere. It qualifies them correctly in
      `where`/`orderBy`, which is why `searchProducts`' very similar subquery has always been fine.
      Replaced with a `leftJoin` + `groupBy`, which keeps every reference bound to the schema.
    - Three 320px layout faults (order number wrapping mid-token, the totals row colliding with its
      own wrapped value, an almost-empty status card on a delivered order), all seen in actual
      screenshots.
  `pnpm check` (0 errors)/`pnpm test` (97/97, 13 new)/`pnpm build` clean. Verified live against the
  real dev Neon DB: order `B260804-DAMN7` walked `paid → packed → shipped → delivered` with a TTN
  saved from grouped input; `B260804-L6NJG` (cash, `confirmed`) cancelled and **SPACE stock went
  2 → 3** with its reservation count at 0; `B260804-LHB7A` (`awaiting_payment`) cancelled and stock
  **stayed** at 3 while its live reservation was released — both halves of the restock rule
  confirmed. Forged POSTs for `paid`, for a jump past a step, from a stale status and with a garbage
  status were each refused with the right message; an unknown order number 404s. 320px checked over
  CDP (`cssContentSize` 320 on both pages) *and eyeballed in screenshots*, plus 1280 for the desktop
  table. Then in a built Worker (`pnpm preview`, where the gate is armed): `/admin/orders`,
  `/admin/orders/<n>` and a POST transition all 403, and the order was still `confirmed` afterwards.
  **Note the dev DB was mutated by this testing** — `DAMN7` is now `delivered` with fake TTN
  `20450123456789`, `L6NJG` and `LHB7A` are `cancelled`. Harmless test rows, not cleaned up.
- **Earlier:** **the admin gate — Phase 4's first item, the app-side half of it.**
  `src/lib/access/index.ts` (`createAccessVerifier`, `extractAccessToken`, `normalizeTeamDomain`,
  18 tests) verifies a Cloudflare Access JWT with Web Crypto: RS256 pinned from our side rather than
  read off the token, the signing key matched by `kid` against
  `<team>.cloudflareaccess.com/cdn-cgi/access/certs`, then `iss`/`aud`/`exp`/`nbf` checked so a
  token minted for somebody else's Access application cannot pass. `src/middleware.ts` grew an
  `adminGate` ahead of the existing rate limiter (`sequence(adminGate, rateLimit)`) covering
  `/admin/**` and `/api/admin/**`; the identity lands on `Astro.locals.admin`. Also added, so the
  gate has something real to protect: `src/layouts/AdminLayout.astro` (its own shell — the panel must
  not inherit storefront chrome) and a placeholder `src/pages/admin/index.astro`.
  - **The Cloudflare side is live too**, because `mlosko.dev` was bought mid-session and cleared the
    blocker (see the entry below). Zero Trust team `mlosko`, a self-hosted application over the dev
    Worker's custom domain, and **One-time PIN** as the login method.
  - **Login is one-time PIN, deliberately.** A new Zero Trust org ships with a *Cloudflare*
    identity provider as its only login method, which would have forced the client and every future
    admin to hold a Cloudflare account. OTP was added instead (Zero Trust → Integrations → Identity
    providers): the admin types their email, gets a 6-digit code, and is in — no account anywhere,
    nothing to connect the client to. **Nothing in the app changed for this**: the gate verifies the
    JWT, and which identity provider minted it is invisible to us. Adding admins later is adding
    email addresses to the Allow policy; free tier covers 50.
  - **The gate fails closed** — unconfigured means deny, not allow. That is what made it safe to
    build and deploy this before Access existed, and it is why `docs/CONVENTIONS.md` wants the check
    in the app rather than trusting edge configuration alone.
  - **`pnpm dev` bypasses the gate**, because nothing authenticates in front of it locally. The
    bypass is behind `import.meta.env.DEV`, a build-time constant — verified, not assumed:
    `dev@localhost` appears nowhere in `dist/` after a build, so it cannot become a production
    bypass. The whole panel is therefore developed locally against the real dev Neon DB.
  - `CF_ACCESS_TEAM_DOMAIN` (`mlosko.cloudflareaccess.com`) / `CF_ACCESS_AUD` are Worker secrets,
    not `wrangler.jsonc` values. Neither is a credential — the gate rests on the signature — but
    both are account-specific and get replaced in Phase 5. Learned along the way: `wrangler types`
    derives `Env` from `.dev.vars`, **not** from `src/env.d.ts`'s declaration merging, so a new
    secret has to exist in `.dev.vars` before `pnpm cf-typegen` will type it.
  `pnpm check` (0 errors)/`pnpm test` (84/84, 18 new)/`pnpm build` clean. Verified live in a built
  Worker before deploying (`pnpm preview`): `/admin` → 403 text, `/admin/orders` → 403 (the gate runs
  before routing), `/api/admin/anything` → 403 JSON, an `alg: none` forgery → 403, while `/`, `/cart`
  stay 200 and `/administrative` still 404s rather than being swallowed by the prefix match. On
  `pnpm dev`, `/admin` renders as `dev@localhost`. Then live on `balier.mlosko.dev` after deploy:
  `/admin` and `/api/admin/x` both 302 to `mlosko.cloudflareaccess.com` carrying our AUD, and
  **Mykhailo completed a real OTP login in a browser** — which exercises both halves at once, since
  a JWT our verifier rejected would have rendered «Доступ заборонено» instead of the panel. That
  also retires the last assumption in `src/lib/access/index.test.ts`'s header note: the JWKS wire
  format is now confirmed by a real login, not just taken from the docs.
- **Earlier:** **order-confirmation email** — the last open Phase 3 item, and the reason the
  Cloudflare plan was upgraded to Workers Paid this session (Email Sending needs it). Reused the
  existing `NotifierPort` shape rather than adding a new port type: `src/lib/notify/email.ts`
  (`createEmailNotifier`, tested) implements it against the new `send_email` binding
  (`EMAIL: SendEmail` in `wrangler.jsonc`), the same three call sites `src/lib/notify/telegram.ts`
  already used (`createOrder`'s two branches, the webhook's `paid` transition) now call both
  notifiers — `CreateOrderDeps` gained an `email: NotifierPort` field alongside `notifier`.
  `DELIVERY_METHOD_LABELS`/`PAYMENT_METHOD_LABELS`/`deliveryDestination` were pulled out of
  `telegram.ts` into a new `src/lib/notify/format.ts` so the two adapters share one copy.
  Two decisions closed by explicit ask rather than guessed (`CLAUDE.md` rule 5):
  - **Trigger point differs from Telegram's, per payment method.** Cash on delivery is genuinely
    confirmed the moment the order is created, so `orderCreated` sends then, same call site as
    Telegram's «Нове замовлення». A card order is not confirmed until Monobank actually reports
    success, so the email adapter's `orderCreated` is a no-op for `card` — only `orderPaid`, fired
    from the webhook's `paid` transition, sends. If a customer abandons payment, no email ever goes
    out for that order, which is correct: nothing was confirmed. The call sites themselves are
    identical to Telegram's for both branches; the payment-method branching lives inside the email
    adapter, not in `create.ts` or the webhook route.
  - **No domain onboarded — sending is built but not live.** `wrangler email sending list` returns
    none; `balier.ua`'s DNS isn't on this Cloudflare account (still a Phase 5 item). Rather than
    picking a throwaway personal domain, `ORDER_EMAIL_FROM` in `wrangler.jsonc` is set to
    `noreply@balier.ua` — the real address — so the code needs no change once
    `wrangler email sending enable balier.ua` is run, whenever a domain actually sits on the
    account that will hold this. Until then every send fails closed with `E_SENDER_NOT_VERIFIED`,
    caught and logged like any `NotifierPort` failure, never thrown into checkout.
  `customerEmail` needed no new plumbing — it was already an optional field on the checkout form,
  validation schema, and `orders` table from a prior session; both `orderCreated`/`orderPaid` are
  silent no-ops when it's absent.
  `pnpm check` (0 errors)/`pnpm test` (66/66, 8 new — this block previously said 74, an arithmetic
  slip; the suite has been counted directly since)/`pnpm build` clean. **Not verified live**:
  `/api/checkout` is gated by the real Turnstile secret, which curl can't satisfy, so a real
  COD-with-email order (to see the send attempt and its graceful failure end to end) needs an
  actual browser pass — same recurring gap as the rest of `/checkout`.
- **Earlier:** **API rate limiting** — `src/middleware.ts` (new) runs a per-IP, per-route
  fixed-window counter (`src/lib/rateLimit/`, KV-backed) ahead of every route
  `docs/CONVENTIONS.md` names (checkout, both Nova Poshta search endpoints) plus `/api/cart` and
  `/api/checkout/limits`, which each already carried their own "not yet rate limited" note.
  `/api/webhooks/monobank` is deliberately excluded — `X-Sign` already gates it, and an IP bucket
  risks dropping a genuine redelivery from Monobank's own infrastructure rather than an attacker's.
  Budgets are sized to cost, not uniform: `/api/checkout` (Turnstile + Monobank + a new row) gets
  5/5min, the debounced NP search inputs get 60/min. New `RATE_LIMIT` KV namespace, created and
  bound in `wrangler.jsonc` (`CACHE` stays uncreated — nothing needs it). Along the way, confirmed
  `balier-cron` **is now deployed** (`wrangler secret list --name balier-cron` returns
  `DATABASE_URL`/`NOVAPOSHTA_API_KEY` instead of "Worker not found") — done in this session before
  the docs below caught up to it, so both stock-reservation release and the Nova Poshta sync are
  finally running on schedule against the deployed dev Worker. `pnpm check` (0 errors)/`pnpm test`
  (58/58, 4 new)/`pnpm build` clean; verified live against the running dev server — tripped the
  limit on `/api/checkout/limits`, got a 429 with a correct `retry-after`, and confirmed the webhook
  keeps answering its own 403 rather than being rate-limited.
- **Earlier still:** the **`orderPaid` Telegram notification** — the last piece of the notification port
  that had been implemented but wired to nothing. `confirmPayment` now `.returning()`s the updated
  order row and carries it (with its already-loaded items) out in the `paid` result, and
  `src/pages/api/webhooks/monobank.ts` sends «Оплачено» to the manager group on that transition only.
  Two properties this shape buys, both deliberate: the send happens **outside** `confirmPayment`'s
  transaction (a network call never holds one open — same rule `create.ts` follows for the Monobank
  call), and it **cannot duplicate** on a redelivered webhook, because `confirmPayment`'s idempotency
  reports an already-`paid` order as `unchanged` and so never produces a second `paid` result. Sent
  via `waitUntil` rather than awaited, so Monobank still gets its fast 200. Two new tests cover the
  real adapter (`telegram.test.ts` previously only tested the pure formatter): the wire call itself
  (`sendMessage`, right `chat_id`, «Оплачено» heading) and that it resolves rather than throwing when
  fetch fails. `pnpm check` (0 errors)/`pnpm test` (54/54, 2 new)/`pnpm build` clean; **confirmed
  working live** — committed as `b6a5d22`.
- **Before that (full account in the session log below, 2026-08-04):** 🎉 **the whole card money
  path was verified live end to end on the deployed dev Worker** — order `B260804-DAMN7` went
  card → Monobank → webhook → `paid`. First completed webhook round trip in the project's history.
  It took fixing two bugs invisible to local testing: the deployed Worker had **no runtime
  `TURNSTILE_SECRET_KEY`** (the dashboard's Build-section variables are build-time env, not runtime
  bindings — see the `cloudflare-build-vars-are-not-runtime-secrets` memory), and `verifyWebhook`
  rejected **every** real webhook because `GET /pubkey` returns base64 of a **PEM document**, not of
  DER (`normalizePublicKey` now unwraps it). The six existing tests had passed throughout, because
  the fixture stubbed DER — the same wrong assumption as the implementation. Committed as `611cb2f`.
- **Also true (from the prior session, unchanged):** Phase 3's "core money path" —
  `/checkout` end to end, `src/lib/orders/`, `src/lib/monobank/` (`PaymentPort` incl. ECDSA
  signature verification), `src/lib/novaposhta/` (client + sync), the checkout/webhook API routes,
  `/checkout` + `/checkout/success` + `/checkout/failure`, and both cron jobs
  (`releaseExpiredReservations`, `syncNovaPoshta`) are real. Telegram notifications
  (`src/lib/notify/telegram.ts`) are wired for **both** events now and verified live. Verified live against the real dev
  Neon DB: COD orders end to end, the strict `cart_changed` rejection rolling back with zero side
  effects, and — with real Monobank/Nova Poshta credentials from Mykhailo's personal dev accounts
  (see `balier-infra-accounts-are-dev` memory) — **card payment confirmed working end to end
  including the paid transition and idempotency** (order `B260804-6DN8Q`). Test orders
  `B260804-BYP3K`, `B260804-S86Y7` (COD) and `B260804-6DN8Q` (card, paid) are real rows in the dev
  DB, harmless, not cleaned up. Webhook HTTP delivery over the real network, including a real
  `X-Sign`, is **now verified** (see the webhook entry above) — that entry is finally closed. Testing this from
  plain `localhost` would still need a tunnel; testing against the deployed dev Worker doesn't, and
  that is the route that worked.
- **In progress:** **Phase 4 — the admin panel.** The gate is done and live (one-time PIN), and
  orders are done. What is left of the phase: **products and content management**, **image upload**
  via `storeImage`, and the **cash-on-delivery limit** (`settings.cod_limit` is read at checkout
  already; nothing writes it). All three are developed against `pnpm dev`, which bypasses the gate.
  Deliberately *not* built with orders, and unasked-for so far: any customer-facing notification on
  an admin status change — «Відправлено» emails are not in the roadmap item, so Telegram and email
  stay wired to order creation and payment only.
  Phase 3 is **code-complete**; what's left there is not code — a domain for Email Sending, and a
  real browser pass through `/checkout` (Turnstile-gated, so curl can't do it). Phase 2 still
  carries its own leftover: the seven static pages render a heading, a lead and a
  `ContentPlaceholder`. Writing them is a Phase 5 content item, and the legal ones gate Monobank.
- **Next step:** the rest of Phase 4 — products/content management and image upload, or the
  cash-on-delivery limit (much the smaller of the two, and it closes a checkout setting that is
  currently read-only). (Still open from Phase 3, unchanged: a real browser checkout pass, COD with
  an email address, to watch the confirmation email attempt and its graceful
  `E_SENDER_NOT_VERIFIED` failure.)
- **Blockers (waiting on me):**
  - Phase 0 externals unchanged: Monobank Acquiring registration, Nova Poshta business account +
    cash-on-delivery setup, Telegram manager account / bot / chat.
  - ~~**No domain on this Cloudflare account**~~ — **resolved 2026-08-04.** `mlosko.dev` was bought
    and onboarded, which cleared both halves of this blocker at once. Two things still outstanding
    on it, both small and both Mykhailo's:
    - **Email Sending DNS records are not added yet.** Sending is enabled on `mail.mlosko.dev`
      (tag `1d4ba47f…`, DKIM selector `cf-bounce`, return path `cf-bounce.mail.mlosko.dev`), but
      the six records it needs — three MX on `cf-bounce.mail`, SPF, DKIM, DMARC — must be created
      in the zone by hand; `wrangler email sending dns get mail.mlosko.dev` prints them exactly.
      Until they exist, order emails keep failing closed.
    - **The Turnstile widget's hostname allowlist may not include `balier.mlosko.dev`.** The
      widget (`0x4AAAAAAEF8vF0-cXNWdOOY`) was created when `localhost` and the `workers.dev` URL
      were the only hosts. If checkout on the new domain returns `captcha_failed`, this is why —
      add the hostname in the Turnstile dashboard. Not yet tested either way.
  - `PUBLIC_TELEGRAM_MANAGER` in `wrangler.jsonc` is a **placeholder handle**.
  - ~~`DATABASE_URL` missing as a Worker secret~~ — resolved; it is set, and as of 2026-08-04 so are
    the other five runtime secrets.
- **Active branch:** `main` (only branch; tracks `origin/main`), pushed at `25457fc`; the orders
  screen above is uncommitted working-tree changes on top of it.
  A push to `main` deploys (Workers Builds is connected to `mykhailoshulezhko/balier`, production
  branch `main`, build `pnpm run build`, deploy `npx wrangler deploy`).

## ✅ Phase tracker (high-level; detail in docs/plans/roadmap.md)

- [~] Phase 0 — Preparation (Neon + R2 done; Monobank, Nova Poshta, Telegram outstanding)
- [x] Phase 1 — Foundation (schema, migrations, seed, design components, deploy verified)
- [~] Phase 2 — Catalog / storefront (every page built; static-page copy outstanding)
- [~] Phase 3 — Cart and payment (code-complete: cart, `/checkout`, both payment methods,
      Turnstile, the webhook, both Telegram notifications, rate limiting, and now the order-
      confirmation email. `balier-cron` is deployed. Only external/non-code items remain: onboarding
      a domain for Email Sending, and a live browser pass through `/checkout`. The admin COD-limit
      UI is Phase 4's item, not this one)
- [~] Phase 4 — Admin panel (the Access JWT gate is built, fail-closed and live behind one-time PIN;
      the orders screen — list, detail, transitions, TTN — is done and verified live. Products and
      content management, image upload and the COD limit are unstarted)
- [ ] Phase 5 — Launch (incl. migrating off the dev Neon/Cloudflare accounts)
- [ ] Phase 6 — Improvements

---

## 🗒️ SESSION LOG (newest first; 3–6 lines each)

### 2026-08-04 — status revert on the admin orders screen

- Did, on report that a status change on `/admin/orders/[orderNumber]` was irreversible: added a
  step-back action alongside the existing forward/cancel/refund ones. `revertTarget(status)` and
  `revertCrossesPayment(order)` in `src/lib/orders/status.ts`; `allowedTransitions` now folds a
  `back` value into what it already returned.
- Decision, closed by asking rather than guessing (two questions: how far back, and whether to
  warn): revert only reaches `packed` — `shipped → packed`, `delivered → shipped` — never further.
  `packed`'s own predecessor is `paid` (webhook-only, hard rule 2) or `confirmed` (`create.ts`-only),
  both of which the panel must never produce; a first draft that made `packed` revert to one or the
  other depending on payment method was caught and corrected before it reached `allowedTransitions`,
  not after. No stock ever moves on a revert — every status in play is already in
  `STOCK_COMMITTED`, so `updateStatus.ts` needed no changes at all. One warning is shown: reverting
  a cash-on-delivery order out of `delivered` flips whether money counts as collected (COD is only
  "paid" at hand-off), so the exit button that follows would silently change from refund to cancel —
  `revertCrossesPayment` catches this generically rather than hardcoding the one case.
- Verified: `pnpm check` (0 errors)/`pnpm test` (102/102, 5 new)/`pnpm build` clean. Live against the
  real dev Neon DB: `B260804-DAMN7` (card, `delivered`) reverted to `shipped`, then to `packed`
  (correctly offered no further revert), a forged `packed → paid` still refused with
  `invalid_transition`, then walked forward again to `delivered` to restore it. No stock change at
  any step.
- **Same session, follow-up ask: "we need an option to go from packed back to paid."** Re-examined
  whether that's actually the forgery hard rule 2 forbids, rather than assuming it is because it
  looked that way five minutes earlier. It isn't: `FORWARD` maps only `paid` and `confirmed` to
  `packed`, and nothing else ever writes `status: 'packed'` (checked by grep) — so an order at
  `packed` necessarily already passed through whichever one matches its `paymentMethod`. Reverting
  restores a status the order demonstrably held, verified by the real webhook for card orders, not
  the panel inventing one. Extended `revertTarget` to pick `paid`/`confirmed` for `packed` by
  payment method (confirmed by asking one more scoping question first: should cod get the parallel
  `packed → confirmed` too — yes), added `ORDER_REVERT_HINTS.paid` so the button can't be misread as
  re-touching Monobank, and rewrote the now-inverted test (`allowedTransitions` used to assert `paid`
  is *never* offered; now asserts it's offered in exactly the one place, and confirmed cross-checked
  that the wrong payment method can never reach the other's target).
- Verified again: `pnpm check`/`pnpm test` (105/105, 3 more)/`pnpm build` clean. Live, same order:
  walked back down to `packed`, forged `packed → confirmed` on this **card** order (refused), did
  the real `packed → paid` revert, confirmed `paid` offers no further revert, walked forward back to
  `delivered`. No stock change.
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit).

### 2026-08-04 — Phase 4, part 2: the admin orders screen

- Did, on request (after confirming the live `/admin` one-time-PIN login works): `/admin/orders`
  list — status filter, search over order number / customer name / phone, pagination — and
  `/admin/orders/[orderNumber]` detail, with the allowed status transitions and the Nova Poshta
  tracking number. `src/lib/orders/status.ts` holds the whole decision layer as pure, tested code
  (`allowedTransitions`, `isStockCommitted`); `src/lib/orders/updateStatus.ts` is the transactional
  plumbing (`FOR UPDATE` re-read, restock, reservation release). Supporting: `validation/admin.ts`,
  `i18n/admin.ts`, `components/admin/OrderStatusBadge.astro`, `queries/like.ts` (the LIKE-escaping
  helper lifted out of `products.ts` so both search paths share one definition), plus `listOrders` /
  `findAdminOrder`.
- Decisions, two closed by asking rather than guessing: **(1) both cancel and refund return stock**,
  but only when it was actually taken — `confirmed`/`paid` and later have decremented and dropped
  their reservation, `pending`/`awaiting_payment` have only reserved, so the second kind releases
  the reservation and increments nothing. **(2) TTN entry is in scope** (`orders.np_ttn` existed in
  the schema with nothing writing to it). Decided without asking, and stated rather than assumed:
  `paid` is unreachable from the panel by construction; cancel and refund are never offered together
  — which of the two appears is decided by whether money has actually been collected, so a cash
  order in transit is cancelled and a card order past `paid` is refunded; `refunded` is bookkeeping
  and the money is returned in Monobank's dashboard; and no customer notification fires on an admin
  status change, since that is not in the roadmap item.
- Found along the way, three bugs that only live testing could have produced: the phone search
  matched **stray digits** (`q=DAMN7` returned six orders, because `7` was matched against every
  phone); the item-count column was **always 0**, because Drizzle renders column references
  *unqualified inside a `select` field* so the correlated subquery compared `order_items` to itself
  — it qualifies them in `where`/`orderBy`, which is why `searchProducts`' near-identical subquery
  has always worked, and the fix is a `leftJoin` + `groupBy`; and three 320px faults visible only in
  actual screenshots. Also learned: **Astro's origin check already refuses cross-site form POSTs**
  (curl needed an explicit `Origin` header), so the panel's writes have CSRF protection for free.
- Verified: `pnpm check` (0 errors)/`pnpm test` (97/97, 13 new)/`pnpm build` clean. Live against the
  real dev Neon DB — `B260804-DAMN7` walked `paid → packed → shipped → delivered`; cancelling cash
  order `B260804-L6NJG` took SPACE stock 2 → 3; cancelling `B260804-LHB7A` (`awaiting_payment`) left
  stock alone and released its reservation; forged POSTs (`next=paid`, a jump past a step, a stale
  `from`, a garbage status) were each refused with the right message. 320px measured over CDP *and*
  eyeballed, 1280 too. Then in a built Worker (`pnpm preview`): every new route 403s, POST included,
  and the order was unchanged afterwards. **The dev DB was mutated by this testing** — `DAMN7` is
  `delivered` with fake TTN `20450123456789`, `L6NJG`/`LHB7A` are `cancelled`.
- Next: the rest of Phase 4 — products/content management and image upload, or the cash-on-delivery
  limit (smaller, and it closes a setting checkout currently only reads).

### 2026-08-04 — Phase 4, part 1: the admin gate (Access JWT)

- Did, on request (started Phase 4, auth first — nothing else in the phase is safe to build without
  it, since every other item is an authenticated write path): `src/lib/access/index.ts` verifies the
  Cloudflare Access JWT with Web Crypto — RS256 pinned by us rather than read from the token's own
  header, signing key matched by `kid` against the team's `/cdn-cgi/access/certs`, then
  `iss`/`aud`/`exp`/`nbf`. `src/middleware.ts` now runs `sequence(adminGate, rateLimit)`, gating
  `/admin/**` and `/api/admin/**` and putting the identity on `Astro.locals.admin`.
  `AdminLayout.astro` + a placeholder `/admin` page exist so the gate protects something real.
- Decisions: **fail closed** — unconfigured is deny, not allow, which matters because Access cannot
  be configured at all yet (it needs a hostname on a zone in the account; `*.workers.dev` cannot be
  one, confirmed against Cloudflare's docs). The deployed Worker therefore 403s `/admin` for
  everyone, us included, and the panel gets built against `pnpm dev`, which bypasses the gate behind
  `import.meta.env.DEV`. That bypass was *verified* rather than assumed — `dev@localhost` appears
  nowhere in `dist/` after a build. This is also the concrete case for why `docs/CONVENTIONS.md`
  wants the check inside the app: the Worker is reachable on a URL no Access policy covers, so edge
  configuration alone would protect nothing here.
- Found along the way: `wrangler types` builds `Env` from `.dev.vars`, not from `src/env.d.ts`'s
  declaration merging — the comment in `env.d.ts` implies otherwise. A new secret must be in
  `.dev.vars` before `pnpm cf-typegen` will type it. Also corrected an arithmetic slip in this file:
  the suite was 66 tests before this session, not the 74 the previous entry claimed.
- Verified: `pnpm check` (0 errors)/`pnpm test` (84/84, 18 new)/`pnpm build` clean. Live in a built
  Worker (`pnpm preview`, which is where the gate is actually armed): `/admin` 403, `/admin/orders`
  403 (the gate runs before routing, so a route that does not exist yet is still refused rather than
  404ing), `/api/admin/anything` 403 as JSON, an `alg: none` forgery 403, `/` and `/cart` still 200,
  `/administrative` still 404 — the prefix match does not over-reach. On `pnpm dev`, `/admin` renders
  as `dev@localhost`. **Not verified:** a real Access login, impossible without a domain — so the
  JWKS response shape is still taken from the docs, and the test file says so at the top rather than
  quietly pretending otherwise (the Monobank fixture lesson).
- Then, same session: **`mlosko.dev` was bought and onboarded, clearing the domain blocker, and the
  gate is live.** The dev Worker now answers on `balier.mlosko.dev` (custom domain), a Zero Trust
  team `mlosko` exists, and a self-hosted Access application covers four destinations —
  `admin`, `admin/*`, `api/admin`, `api/admin/*`. All four are needed: Access matches the path
  exactly unless wildcarded, and a wildcard does **not** cover its own parent, so `admin` alone
  would have left `/admin/orders` uncovered and `admin/*` alone would have left `/admin` uncovered.
  `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` are set as Worker secrets. Verified live after deploy:
  `/` 200, `/admin` and `/api/admin/x` both 302 to `mlosko.cloudflareaccess.com` with our AUD.
  Email Sending is enabled on `mail.mlosko.dev` — a subdomain rather than the apex on purpose, so
  `mlosko.dev` can still take real inbound mail later without colliding MX records.
- **Login method: one-time PIN, not Cloudflare accounts.** A new Zero Trust org arrives with a
  *Cloudflare* identity provider as the only login method — which would have meant the client, and
  every admin they ever add, needing a Cloudflare account. Added One-time PIN instead (Zero Trust →
  Integrations → Identity providers; OTP is no longer added automatically, which is why it was
  missing). The admin enters an email, receives a 6-digit code, and is in: no account, nothing
  connecting the client to Cloudflare. Codes expire in 10 minutes and are single-use. **This needed
  no code change** — the gate verifies the JWT and never sees which provider issued the identity —
  and it is the reason not to hand-roll email+password auth in the app: OTP already delivers the
  goal (the client needs only an email address) without password hashing, sessions, reset flows or
  lockout logic in a Workers runtime with no native bcrypt/argon2.
- **`workers.dev` is now off.** Adding a `routes` entry makes wrangler disable it by default;
  `balier-dev.mykhailoshulezhko.workers.dev` 404s. Kept that way and made explicit
  (`"workers_dev": false`) rather than left to a default — it was a second public surface no Access
  policy could cover. **Session-log entries above this one that name it as the live test URL are
  historical**; the live dev URL is `https://balier.mlosko.dev`.
- Next: `/admin/orders` — list, detail, and the status transitions the order state machine allows.

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

- Did, on report from live testing against `balier-dev.mykhailoshulezhko.workers.dev` ("captcha
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
