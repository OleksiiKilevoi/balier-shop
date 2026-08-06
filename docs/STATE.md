# STATE — balier.ua

> Single source of truth for "where did we stop". Read aloud at session start.

## 📍 CURRENT STATE (overwrite this block; keep tight)

- **Last done:** **order confirmation emails deliver now** (2026-08-06). The request was «build
  email notifications» — exploration showed all four paths were already built and tested in Phase 3
  (COD → email at creation in `create.ts`; card → email on the webhook's `paid` transition + cron
  fallback; admin `/admin/orders/new` goes through the same `createOrder`; no email → silent skip).
  The only thing missing was operational: the six Email Sending DNS records for `mail.mlosko.dev`.
  They were added via the dashboard's auto-onboard, all six confirmed resolving on 1.1.1.1, a
  `wrangler email sending send` smoke test reported **Delivered**, and a real COD order
  (`B260806-A9AYA`, with an email address) was placed through the deployed `/api/checkout` to fire
  the real path. Zero code changed. Categories-fix and image-session details are in the log below.
- **In progress:** nothing. All of the above is **uncommitted** — see «Active branch».
- **Next step:** finish the **browser pass** this session started. `/admin/products` and its editor
  have been driven for real; `/admin/categories` has now been rewritten but *not* driven, and
  `/admin/settings` is still a screen nobody has ever looked at — both need a real browser, and the
  upload bug is the standing evidence for what that distinction is worth. `/admin/settings` is also
  the last screen still on the reload-and-scroll-to-top path the new convention forbids. Then
  commit + deploy, then Phase 5.
- **Rules that bind any future panel screen** (now written up in `docs/CONVENTIONS.md` → «Admin
  panel»: the `admin.css` utilities, `src/components/admin/`, and the no-reload/toast contract):
  - **A schema is only verified against the body the form actually sends.** `curl -F` composes a
    body by hand and will happily supply a field no control on the page renders, so a screen can
    pass a full curl pass and be unusable in a browser — which is exactly what happened to image
    upload for three sessions. Validation tests build their body from a real `FormData`, and «tested
    over curl» is not «tested».
  - **The no-script rule is dead as of 2026-08-05.** The replacement is progressive enhancement: the
    form must work as a plain form, and script may make it better on top. The catalog screens take
    the plain-PRG end of that; `/admin/orders/new` takes the reload-free end. Requiring script is
    not legitimate. (`docs/CONVENTIONS.md` may still word the old rule.)
- **Still worth carrying:**
  - **`pnpm dev` writes to the real R2 bucket now** — `wrangler.jsonc`'s MEDIA binding carries
    `"remote": true` (2026-08-06). Before that, dev bound MEDIA to Miniflare's simulated bucket
    under `.wrangler/state/v3/r2/`, so a photo uploaded through the panel was written to disk while
    its `product_images` row went to the *real* Neon database — local R2 against remote Postgres is
    the one combination that produces broken data rather than a broken screen. Two consequences:
    dev needs Cloudflare auth to read or serve media at all, and an upload made while testing is a
    real object in the real bucket. `CLOUDFLARE_VITE_FORCE_LOCAL=true pnpm dev` forces the old
    isolated behaviour for a session without editing config.
  - **`MAX_ITERATIONS = 100_000` in `src/lib/auth/password.ts` is a hard runtime ceiling, not a
    tuning choice** — the Workers runtime refuses PBKDF2 above it, and *only the deployed runtime
    does*: Node, Vite's dev server and `wrangler dev`'s own workerd all derive 210 000 happily, so
    no local gate can catch a breach of it. It is also under OWASP's 600 000 — an open decision,
    deliberately not taken.
  - **A session cannot be revoked before its 12 hours are up** — rotating `ADMIN_SESSION_SECRET` is
    the only way to end all of them at once. The price of the stateless signed cookie.
  - **Turnstile is commented out, not deleted** (`grep -rn "Turnstile:" src wrangler.jsonc` to
    restore), so **the KV rate limiter is the only bot defence on `/api/checkout`** — 10/min per IP.
  - Leftovers from earlier phases: Phase 3 is code-complete but still wants a real browser pass
    through `/checkout` (no longer Turnstile-gated, so curl can drive it) and the Email Sending DNS
    records below; Phase 2's seven static pages still render a heading, a lead and a
    `ContentPlaceholder` — writing them is a Phase 5 content item, and the legal ones gate Monobank.
  - Deliberately not built and unasked-for: any customer-facing notification on an admin status
    change. Telegram and email stay wired to order creation and payment only.
- **Blockers (waiting on me):**
  - **`balier-cron` needs three new secrets before its next deploy** — the reconciliation sweep
    calls Monobank and Telegram now: `wrangler secret put MONOBANK_TOKEN -c
    workers/cron/wrangler.jsonc`, likewise `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (same values as
    the app Worker; secrets are per-Worker). Until set, the sweep fails closed: expired stock is
    still freed, `awaiting_payment` orders are left untouched rather than cancelled on a guess.
  - Phase 0 externals unchanged: Monobank Acquiring registration, Nova Poshta business account +
    cash-on-delivery setup, Telegram manager account / bot / chat.
  - `PUBLIC_TELEGRAM_MANAGER` in `wrangler.jsonc` is a **placeholder handle**.
  - Small cleanup: `wrangler secret delete CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` — both are still
    set on the Worker and read by nothing since the auth switch.
  - Dormant, not resolved: the Turnstile widget (`0x4AAAAAAEF8vF0-cXNWdOOY`) was created when
    `localhost` and the `workers.dev` URL were the only allowed hosts, so its hostname allowlist may
    not include `balier.mlosko.dev`. Never tested either way; it matters again the moment Turnstile
    is uncommented.
- **Active branch:** `main` (only branch; tracks `origin/main`), clean up to `c6608d4` and level
  with `origin/main`. **Phase 4 is deployed** — `wrangler deployments list` shows the live version
  created 2026-08-05T19:10:58Z, one minute after `c6608d4`, so the whole panel (order creation,
  settings, the catalog screens, migration `0005`) is on `balier.mlosko.dev`. Earlier copies of this
  block said none of it was pushed; that was stale, and the deploy was verified rather than assumed.
  **Uncommitted right now: this session's image work and the categories fix** — `catalog.ts`,
  `media/index.ts`, `media/upload.ts`, `i18n/admin.ts`, `products/[id].astro`, `categories.astro`,
  the new `lib/admin/forms.ts`, `wrangler.jsonc`, `docs/CONVENTIONS.md`, and three test files.
  A push to `main` deploys (Workers Builds on `mykhailoshulezhko/balier`, production branch `main`,
  `pnpm run build` → `npx wrangler deploy`) and it is **not instant** — `npx wrangler deployments
  list` shows when a version actually landed.
- **Dev DB state (real rows, harmless, deliberately not cleaned up):** ten orders. From the Phase 3
  and admin passes: `B260805-XVFYQ` (COD, placed by curl with no captcha token — the proof Turnstile
  is off), `B260804-6DN8Q` (card, paid through the real webhook), `B260804-BYP3K` / `B260804-S86Y7`
  (COD), `B260804-DAMN7` (walked all over by the admin screens — `delivered`, fake TTN
  `20450123456789`), and `B260804-L6NJG` / `B260804-LHB7A`, `cancelled` from before migration `0003`
  so they correctly offer no revert. From the panel's own create screen: `B260805-67RJB` (COD,
  `confirmed`), `B260805-A88BY` (card, `awaiting_payment`, real Monobank invoice) and
  `B260805-BLF43` (COD courier with an email address — the one that proves the confirmation email
  fires on that path), and `B260806-A9AYA` (COD warehouse, `lxstspxrk@gmail.com` — the first order
  placed *after* the Email Sending DNS records existed, i.e. the first whose email could actually
  deliver). From the catalog session, the first rows the *panel* created: product
  `sumka-test-liunet` left **archived** (two variants; its three image rows were removed again
  during the 2026-08-06 upload testing) and category `testova-katehoriia` left **deactivated** —
  archived rather than deleted on purpose, since archive-only is the rule the feature ships. The
  five seeded products are untouched and all `active`. **`admin@balier.com` is the only enabled
  admin account.**
- **Media state (checked 2026-08-06, not inferred):** all **17** `product_images` rows —
  `lorem-ipsum`, `lunet`, `space`, `wallet` — point at seeded objects that are in `balier-media`,
  so nothing in the catalog is a broken image. Five objects sit in the *local* Miniflare store and
  nowhere else (`1c04e803…webp`, `4564fe2f…png`, `8708b591…jpg`, `9603d232…avif`, `b2054604…jpg`),
  referenced by no row: leftovers from uploads whose rows were later removed. **Removing a photo
  deletes the row and deliberately not the object** — keys are content hashes, so an object may be
  shared, and orphaned bytes are the safe side of that trade. There is no reaper for them.

## ✅ Phase tracker (high-level; detail in docs/plans/roadmap.md)

- [~] Phase 0 — Preparation (Neon + R2 done; Monobank, Nova Poshta, Telegram outstanding)
- [x] Phase 1 — Foundation (schema, migrations, seed, design components, deploy verified)
- [~] Phase 2 — Catalog / storefront (every page built; static-page copy outstanding)
- [~] Phase 3 — Cart and payment (code-complete: cart, `/checkout`, both payment methods, Turnstile
      (built, then commented out on request — the code stays), the webhook, both Telegram
      notifications, rate limiting, the confirmation email, `balier-cron` deployed, and as of
      2026-08-06 the Email Sending DNS records exist and deliver. Only a live browser `/checkout`
      pass remains)
- [x] Phase 4 — Admin panel (its own login form — PBKDF2 + signed session cookie, fail-closed,
      verified on the deployed Worker; orders list, detail, transitions, TTN and manual order
      creation; `/admin/settings` for the COD limit; and the catalog — `/admin/products`, its
      editor, `/admin/categories` and image upload. **Nothing in the phase is deployed yet** — see
      «Active branch»)
- [ ] Phase 5 — Launch (incl. migrating off the dev Neon/Cloudflare accounts)
- [ ] Phase 6 — Improvements

---

## 🗒️ SESSION LOG (newest first; 3–6 lines each)

> Empty by design. Everything through the end of Phase 4 was moved to **`docs/history.md`** on
> 2026-08-05, not rewritten — this file is read in full at every session start and had reached
> 852 lines. New session entries go here; move a phase's entries across once the phase is done.

**2026-08-06 (email DNS session).** Asked to «build order confirmation emails» — they were already
built (Phase 3: `notify/email.ts` routes COD→`orderCreated`, card→`orderPaid`; checkout, webhook,
cron and `/admin/orders/new` all wired; optional email skips silently). The real gap was the known
blocker: the six DNS records for `mail.mlosko.dev` were never in the zone, so every send died on
`E_SENDER_NOT_VERIFIED`, silently. Added via the dashboard auto-onboard button (wrangler's OAuth
token has no DNS-edit scope, so the API route was closed); all six verified on 1.1.1.1;
`wrangler email sending send` smoke test → Delivered; live COD order `B260806-A9AYA` placed through
deployed `/api/checkout` with a real email. No code changed. Known hole left open on purpose: no
test asserts the call sites pass a *real* email notifier — swapping in `createNoopNotifier` would
pass all 221 tests.

**2026-08-06 (categories fix).** `/admin/categories` was still on the old deal: save → 303 → full
reload → top of the page, with the answer in a banner the manager had scrolled away from. Rather
than copy the product editor's script a second time, that script moved out to
`src/lib/admin/forms.ts` as `enhanceAdminForms({ root, toastHost, messageId, onRender })` — swap in
place, focus restored by id or `data-form`, the server's own `<p>` moved into `.admin-toast-host`,
and a real submit as the fallback on any fetch failure. `[id].astro` now calls it and keeps only its
colour-swatch listener; `categories.astro` calls it and re-delegates its slug suggestion (the old
listener held nodes the swap replaces). `/admin/orders/new` untouched on purpose. Rule written into
`docs/CONVENTIONS.md` → «Admin panel». 221 tests, check and build clean; no browser pass yet.

**2026-08-06 (images session).** Drove the product editor in a browser and found upload broken for
every browser that has ever tried it: `imageAddSchema` required an `alt` the upload form does not
have, so real uploads got «Не вдалося зберегти зміни.» while the curl pass that «verified» this
screen passed `-F alt=…` and never saw it. Fixed, plus three asked-for changes: dropped the pixel
and orientation rules (`object-cover` in a fixed-ratio box at every render site makes them
invisible), added the file size to each photo row via an R2 `head()` and the new `mediaKeyFromUrl`,
and derived the format list in `ADMIN_UPLOAD_HINT` / `unsupported_format` from `MEDIA_FORMATS`.
Then the reason none of it reached Cloudflare: `pnpm dev` bound MEDIA to Miniflare's local bucket
while the DB was the real Neon — `"remote": true` on the binding, verified with an object that
exists locally and not remotely. 221 tests; uncommitted.

**2026-08-05 (audit session).** A consultation audit of the whole money path found one real gap —
a customer could pay an order that ends up `cancelled`, silently (cron-vs-webhook race, admin
cancel leaving the invoice payable, lost webhook). Fixed all three: cron reconciles
`awaiting_payment` against Monobank instead of cancelling on TTL alone (doubles as lost-webhook
recovery), cancellation now removes the invoice (`PaymentPort.removeInvoice` → `invoice/remove`),
and `confirmPayment` returns `paid_after_cancellation` → manager Telegram refund alert. Touched:
`ports.ts`, `monobank/`, `notify/*`, `confirmPayment.ts`, `create.ts`, `updateStatus.ts`, the
webhook route, `[orderNumber].astro`, `workers/cron/*`. 213/213 tests; uncommitted like the rest.
Audit also noted (not built): `confirmPayment` doesn't compare the paid amount; pubkey fetched per
webhook (works, diverges from OVERVIEW's KV-cache plan); checkout's 5/5min IP budget vs CGNAT.
