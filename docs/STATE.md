# STATE — balier.ua

> Single source of truth for "where did we stop". Read aloud at session start.

## 📍 CURRENT STATE (overwrite this block; keep tight)

- **Last done:** **the `/checkout` Nova Poshta pickers got faster and stopped depending on
  perfect Ukrainian spelling** (2026-08-06, migration `0006`). Search now matches a folded
  `search_text` column carrying NP's Ukrainian, **Russian (`DescriptionRu`) and Latin
  (`DescriptionTranslit`)** spellings — all three were in every API response and the sync had been
  discarding them. `packages/lib/src/novaposhta/normalize.ts` folds `і/ї/ы/й→и`, `є/э/ё→е`, `ґ→г`
  and drops soft signs and apostrophes, so a Russian keyboard («Днипро», «Харкив», «мыколаив»)
  finds the Ukrainian name — verified against real data. `pg_trgm` + a GIN index took the
  settlement query from a **8.9 ms seq scan to 0.14 ms**; the two endpoints are **edge-cached**
  (`apps/site/src/lib/edgeCache.ts`, 1 h `s-maxage`), which is the real win since the query was
  never the cost — the ~45 ms Worker→Neon round trip was. Typo fallback is pg_trgm `<%` at its
  default 0.6, indexed; a more forgiving 0.4 was tried and **rejected on measurement** (78 ms seq
  scan and the answers turn to noise). **Three bugs fixed on the way:** branch lists were ordered
  lexicographically (Kyiv opened 1, 10, 10063, … — now `number_sort`), `is_active` was hardcoded
  `true` by the sync so closed branches stayed selectable (now from `WarehouseStatus`/
  `DenyToSelect`, plus branches that vanish from the feed are retired), and the checkout client
  had no `AbortController`, so a slow reply for «ки» could repaint over «київ».
  Under the settlement input there is now a row of **one-tap suggestion chips**: the four
  settlements with the most NP branches (Київ, Львів, Дніпро, Одеса — `warehouse_count`, not a
  hardcoded list), plus the visitor's own city first when Cloudflare's `request.cf.city` resolves
  to one. That geo lookup is free of any new dependency — `cf` is workerd's per-request bag, and
  it resolves because `name_translit` ("Kyiv", "Lviv") is now in `search_text`. It is a
  suggestion, never a prefill: Cloudflare geolocates the ISP's egress, so it can name a nearby
  city rather than the customer's, and the chip still has to be tapped.
  Also this session: **courier delivery is withdrawn**, and the branch field's label is now
  dynamic («Відділення» / «Поштомат», with the dropdown's `aria-label` following it) instead of
  the ambiguous «Відділення / поштомат». `np_courier` is gone from the storefront, the admin
  order form and `deliverySchema` — `POST /api/checkout` answers a courier payload with 400,
  verified. **The `delivery_method` enum keeps `np_courier`** so the 6 existing courier orders
  still load and render; `readDraft` now accepts only the *selectable* methods
  (`SELECTABLE_DELIVERY_METHODS`), so a stale or forged form naming courier falls back to
  «відділення» rather than producing a draft nothing can render. The dead address plumbing went
  with it (`np_address` stays on the row and in the notification formatter, for those same
  historical orders).
- **In progress:** nothing. The gate is green (`pnpm check && pnpm build`, 232 tests). Migration
  `0006` and a full `pnpm np:sync` have been run against the **dev** database: all 26 791
  settlements carry `name_ru`/`name_translit`, 53 511 of 53 556 warehouses carry `description_ru`,
  and the first run of the new retirement step deactivated **45** branches no longer in NP's feed.
  Spot-checked live afterwards: «Киев»→Київ, «Львов»→Львів, «Николаев»→Миколаїв,
  «Запорожье»→Запоріжжя, «Кривой Рог»→Кривий Ріг, «Kyiv»/«Lviv», and the typo «хркив»→Харків
  through the fuzzy tier.
- **Next step:** the standing **browser pass** — `/checkout`'s delivery step is the one to drive
  first, since this session changed it and only curl/DB-level checks have been run against it;
  then `/categories` (rewritten, never driven) and `/settings` (never looked at) on
  `admin.balier.mlosko.dev`, plus the panel flows curl cannot drive (image upload preview,
  `/orders/new` card order confirming the Monobank invoice's URLs). Then Phase 5.
  **Not yet deployed** — the two Workers need a push/deploy to pick this up, and **`balier-cron`
  needs a redeploy too** this time: the sync changes live in `@balier/lib`, so the note below
  about the split not requiring one no longer applies to this change.
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
  - **`balier-cron` is fully provisioned and its reconciliation is live** (verified 2026-08-06, not
    assumed): all five secrets present per `wrangler secret list` — `DATABASE_URL`,
    `NOVAPOSHTA_API_KEY`, `MONOBANK_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — and the
    deployed code has the sweep, since version `27405ec5` (2026-08-05 16:46 UTC) postdates commit
    `e8d8447` (16:43 UTC) by three minutes. Everything after that commit is the `~/lib` →
    `@balier/lib` import rewrite and comments, so **the workspace split does not require a cron
    redeploy**. `send_email` / `ORDER_EMAIL_FROM` were already in that deploy and the DNS records
    now exist, so the sweep's order-paid email delivers too.
  - **Admin sessions did not survive the split** — `balier-admin-dev` got a **fresh
    `ADMIN_SESSION_SECRET`** at deploy (the `__Host-` cookie could not cross hostnames anyway).
    Log in again on `admin.balier.mlosko.dev`. The old secret is still set on `balier-dev` where
    nothing reads it now — cleanup item below.
  - **Dev writes to the real R2 bucket** — both apps' MEDIA bindings carry `"remote": true`
    (2026-08-06). Before that, dev bound MEDIA to Miniflare's simulated bucket under
    `.wrangler/state/v3/r2/`, so a photo uploaded through the panel was written to disk while
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
  - Phase 0 externals unchanged: Monobank Acquiring registration, Nova Poshta business account +
    cash-on-delivery setup, Telegram manager account / bot / chat.
  - `PUBLIC_TELEGRAM_MANAGER` in `wrangler.jsonc` is a **placeholder handle**.
  - Small cleanup on `balier-dev` (run from `apps/site`): `wrangler secret delete
    CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` (dead since the auth switch), and now also
    `ADMIN_SESSION_SECRET` / `NOVAPOSHTA_API_KEY` (moved to the admin and cron Workers
    respectively — nothing on the site Worker reads either).
  - Dormant, not resolved: the Turnstile widget (`0x4AAAAAAEF8vF0-cXNWdOOY`) was created when
    `localhost` and the `workers.dev` URL were the only allowed hosts, so its hostname allowlist may
    not include `balier.mlosko.dev`. Never tested either way; it matters again the moment Turnstile
    is uncommented.
- **Active branch:** `main`, clean, with the `workspace-split` branch merged in. (The previous
  block's «uncommitted image work» was stale — all of it was committed and deployed as
  `5a8bfae`…`04adb85` before this session started; verified against `wrangler deployments list`,
  the deploy landed one minute after `04adb85`.) **A push to `main` currently deploys nothing but
  a failed build** — Workers Builds still runs the old root `pnpm run build`; see «Next step».
  Both Workers were deployed manually from the merge commit and verified.
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
      creation; `/settings` for the COD limit; and the catalog — `/products`, its editor,
      `/categories` and image upload. Deployed; since the split the whole phase lives on
      `admin.balier.mlosko.dev`)
- [ ] Phase 5 — Launch (incl. migrating off the dev Neon/Cloudflare accounts)
- [ ] Phase 6 — Improvements

---

## 🗒️ SESSION LOG (newest first; 3–6 lines each)

> Empty by design. Everything through the end of Phase 4 was moved to **`docs/history.md`** on
> 2026-08-05, not rewritten — this file is read in full at every session start and had reached
> 852 lines. New session entries go here; move a phase's entries across once the phase is done.

**2026-08-06 (checkout search).** Asked how the NP city/branch pickers could be faster and forgiving
of Russian input and typos. Measured first: the SQL was never the cost (8.9 ms) — the ~45 ms
Worker→Neon round trip on every keystroke was, and `no-store` meant everyone paid it. So: edge
caching (1 h), `pg_trgm` + GIN (8.9 ms → 0.14 ms), and a `search_text` column folding NP's
Ukrainian/Russian/translit spellings, all three of which the API already returned and the sync
threw away. Fuzzy fallback is `<%` at the indexed default 0.6 — 0.4 was measured and rejected
(78 ms, noisy). Fixed alongside: lexicographic branch order, `is_active` hardcoded `true`, and a
missing `AbortController` that let stale responses repaint the dropdown. Migration `0006`, new
`normalize.ts` (+11 tests, 232 total), gate green.

**2026-08-06 (workspace split).** Asked whether the site and the panel could be two Workers —
planned and built the full split in one session. pnpm workspace: `@balier/lib` (old `src/lib`
verbatim + `stores/cart.ts` + the extracted `media/serve.ts`; internal imports made relative, all
221 tests moved with it), `@balier/site`, `@balier/admin`, `@balier/cron`. Panel serves root paths
on `admin.balier.mlosko.dev` (`safeNext` reduced to "any local path", gate inverted to
allowlist `/login`, `/logout`, `/media/**`), site keeps a 301 `/admin/**` → admin host. New
`SITE_ORIGIN` var: panel-minted Monobank invoices point webhook/redirect at the storefront.
Secrets split per Worker (`balier-admin-dev` got a fresh session secret); `.dev.vars` split
four ways; lib types via `workers-types/experimental` aliases so its DOM-side modules coexist.
Both Workers deployed and verified over HTTPS; Workers Builds dashboard configs are the one
thing code cannot fix — see «Next step». CLAUDE.md command block updated (no root `deploy`
script — pnpm builtin shadows it; `deploy:site` / `deploy:admin`).

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
