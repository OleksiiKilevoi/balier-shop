# STATE — balier.ua

> Single source of truth for "where did we stop". Read aloud at session start.

## 📍 CURRENT STATE (overwrite this block; keep tight)

- **Last done:** **the Nova Poshta sync stopped rewriting the whole country every night**
  (2026-08-06, migration `0010`). Neon reported 361 MB for a shop with seven products; the database
  itself was 144 MB, 94% of it the two NP tables, and the gap was retained history for nightly
  writes that changed nothing. Upserts are now conditional (`db/upsert.ts`), retirement reads the
  new `np_sync_seen` scratch table instead of inferring from `updated_at`, and warehouse
  `search_text` lost its separator-free variant. A full sync now writes **17 settlement rows
  instead of 26 791**; after a `VACUUM FULL` the dev database is **64 MB**. The `/checkout` searches
  were re-driven against the slimmed data («хркив»→Харків, «Крещатик» and «вул.Хрещатик» both
  finding Kyiv branches). **`balier-cron` redeployed the same day** — version `26fa1ef6`, both
  schedules re-registered, all five secrets still present per `wrangler secret list`. That deploy
  was the deadline: the old Worker would have re-bloated the tables at 04:00 UTC. The **first
  deployed run of the new sync is that 04:00 tick** — worth a look at the sizes afterwards, since
  every local run so far was `tsx`, not the Workers runtime.
- **Previously:** **`/users` — its own screen, with an archive** (2026-08-06, migration `0009`).
  Four asked-for changes to the panel. (1) Accounts can now be **removed**, in two steps that are
  deliberately not one: «Видалити» sets `admin_users.archived_at`, which drops the row out of the
  list into an «Архів» tab, ends its sessions, and is undone by «Відновити»; only from that tab,
  behind the address **typed back**, does «Видалити назавжди» actually `DELETE` the row and free
  the email. So no single click anywhere destroys an account, and `lastLoginAt` survives everything
  but the last one. **Archiving deliberately leaves `is_active` alone**, so a restore returns the
  account in the state it was removed in — which only works because `sessionStillValid` reads the
  two facts separately, and an archived row may well still be `is_active: true`. (2) Managing other
  people moved off `/settings` onto **`/users`**, admin-only, with a fourth nav item rendered only
  for admins (the manager's header is unchanged, and the role comes from the live row, so a
  demotion takes the link away on the next request). `/settings` is now two sections: the COD limit
  and your own password. (3) «Власну роль і доступ змінити не можна…» is gone — your own row simply
  carries no controls, just the role badge, «це ви» and a link to `/settings`. The server still
  refuses `self_demote` / `self_archive` / `self_password` for hand-made bodies. (4) The default
  `::marker` is gone panel-wide (a base rule, so nothing can ship with it by omission);
  `.admin-disclosure` grew a chevron in a hover/open well and a `::details-content` slide behind
  `@supports`, plus an `.admin-disclosure-danger` variant for the two destructive ones — and
  «Інші дії» on the order page finally uses the component instead of its own markup.
- **In progress:** nothing. The gate is green (`pnpm check && pnpm build`, **266 tests**).
  Migrations `0006`–`0010` are all applied to the **dev** database. **Driven end to end locally**
  against the dev server, every rendered control's `name` checked against the schema: archive →
  archive tab → restore → archive again; a real purge (mixed-case address accepted, `normalizeEmail`
  does the matching) and then **the same address re-used for a new account**; every refusal —
  wrong address, blank address, `user_purge` aimed by hand at a **live** account (refused by the
  query layer's `IS NOT NULL`, not by the screen), self-archive, self-demote, self-password,
  `email_taken` naming the archive, a short password; a **manager** getting 403 on `/users` with no
  row leaked and no nav item, and their hand-made `user_create` refused with no row written. The
  one that matters most: a manager **signed in**, then archived, is turned away on their *next*
  request (`session_expired`) and cannot log in — with `is_active` still `true` — and after a
  restore signs in fresh while the pre-archive cookie stays dead. Not yet driven in a **browser**:
  the `enhanceAdminForms` swap/toast on `/users` and the new disclosure CSS (curl runs no script and
  paints nothing).
- **Deployed 2026-08-06, admin Worker only** — `balier-admin-dev` **`7ff84793`**, verified over
  HTTPS on `admin.balier.mlosko.dev`: a full create → archive → restore → archive → purge round
  trip made *through the deployed panel*, the typed-address guard refusing a wrong one, both tabs
  rendering with their counts, the nav's fourth item present, and the removed sentence gone.
  `balier-dev` and `balier-cron` were **deliberately not redeployed** — nothing they import
  changed (checked, not assumed: neither app references `queries/adminUsers`, `auth/session`,
  `validation/admin` or `i18n/admin`). Migration `0009` was applied to the dev database **before**
  the deploy, which is the required order — the gate reads `archived_at` on every request.
  **Deployed but NOT committed**, like the sessions work before it: the working tree still holds
  everything above.
- **One loose end from this session's driving, unresolved:** `qa-live@balier.test` was found
  switched **on** at 19:09 EEST with `sessions_valid_from` stamped in the same instant — the
  signature of a `user_save` that changed the active flag — and **no command in this session
  accounts for it**. Set back to disabled. It is a QA row in the dev database and no deployed code
  depends on it, but it is written down rather than quietly tidied away, because the honest state of
  things is that one write is unexplained.
- **Deployed 2026-08-06, all three Workers, verified over HTTPS** — `balier-admin-dev`
  (**`c8d656f2`**, the revocation build; `2f82ee50` was the users build earlier the same day),
  `balier-dev` (`2fea0176`) and `balier-cron` (`39167a18`, all five secrets still
  present after the «override remote configuration» warning). The panel's users section was driven
  on `admin.balier.mlosko.dev`, not just locally: a user **created through the deployed panel**
  signs in, the duplicate is refused, and a password was changed live — which is the check that
  matters most, since the PBKDF2 iteration ceiling only bites on the deployed runtime and no local
  gate can catch a breach of it. The storefront's NP search from the previous session is live too
  («Киев»→Київ, «хркив»→Харків, «Lviv»→Львів against the deployed endpoint).
  **Everything above is deployed but NOT committed** — the working tree still holds this session's
  changes.
- **Next step:** the standing **browser pass** — `/checkout`'s delivery step is the one to drive
  first, since only curl/DB-level checks have been run against it; then `/categories` (rewritten,
  never driven), `/settings`, and now `/users`, whose script layer and whose disclosure CSS are the
  newest untested things in the panel, on `admin.balier.mlosko.dev`, plus the panel flows curl
  cannot drive (image upload preview, `/orders/new` card order confirming the Monobank invoice's
  URLs). Then Phase 5.
  **A production deploy needs `pnpm db:migrate` against that database and one
  `pnpm admin:user role <email> admin`, or the panel ships with nobody able to add a user.**
  Migrations `0008` **and `0009`** must land **before** that deploy — the gate reads
  `sessions_valid_from` and now `archived_at` on every request, so code ahead of schema is a panel
  nobody can open.
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
    `e8d8447` (16:43 UTC) by three minutes. The workspace split alone did not require a cron
    redeploy; the 2026-08-06 sync change did, and got one — `26fa1ef6`, secrets verified after. `send_email` / `ORDER_EMAIL_FROM` were already in that deploy and the DNS records
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
  - **Sessions are revocable per account as of 2026-08-06** (`sessions_valid_from` + the gate's
    per-request row read). Rotating `ADMIN_SESSION_SECRET` is still the way to end *everyone's* at
    once, and it is still the only lever if the database itself is the problem.
  - **`pnpm admin:user` cannot reach the archive** — no command writes `archived_at`, and `enable`
    now says so out loud when the account it just re-flagged is archived anyway. Archiving and
    purging are panel actions on purpose: the irreversible one should take a screen that shows what
    is being deleted. `list` prints `[arch]` ahead of `[on]`/`[off]` for the same reason — an
    archived row is usually still `is_active`, and the recovery tool must not say `[on]` about an
    account that cannot sign in.
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
  admin account, and the only one with the `admin` role.** Five disabled rows sit alongside it:
  `qa-catalog@`, `qa-users@balier.test` (admin), `anna@balier.test`, `qa-live@balier.test` (the
  account created *through the deployed panel* as proof it works) and `qa-arch@balier.test` (admin,
  created by `pnpm admin:user` to drive the archive pass). **One row is archived on purpose:**
  `qa-settings@balier.test` — its original row was **purged** during the pass and the address
  immediately re-used for a new account, which is the proof that a purge frees the email; the new
  row was then archived and left there so the «Архів» tab has something in it for the browser pass.
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

**2026-08-06 (Nova Poshta sync stopped rewriting the country).** Asked why Neon reported 361 MB.
It wasn't data: `pg_database_size` was 144 MB, 94% of it the NP reference tables, and the rest was
retained history for writes that changed nothing — the sync re-upserted all ~80k rows nightly, and
Postgres cannot update a row in place, so every one left a new tuple. Three changes, migration
`0010`. (1) Both upserts carry `setWhere: differsFromExcluded(...)`, from `db/upsert.ts`, whose two
helpers take the *same* column list so a column in the `set` can't silently drop out of the
comparison and stop syncing. (2) Retirement no longer means "whose `updated_at` this run didn't
touch" — which only worked *because* everything was rewritten — but "whose ref is not in
`np_sync_seen`", a scratch table truncated per run and filled from the unfiltered pages; the
clock-skew allowance is gone with it. (3) Warehouse `search_text` drops the separator-free variant
(`addressSearchText`): it earns its keep for «іванофранківськ», not for street addresses. Measured
on dev, not assumed: a second full sync against an unchanged feed wrote **0 rows** to either table,
and after a `VACUUM FULL` the database is **64 MB, down from 144**. Neon's own 361 MB figure is
retained history and decays on its schedule, not ours — it will not drop on the day. 266 tests;
gate green; `balier-cron` redeployed (`26fa1ef6`).

**2026-08-06 (users page + archive).** Four asked-for panel changes. Migration `0009` adds
`archived_at`, and removal became two steps — archive (reversible, sessions ended, `is_active`
deliberately untouched so a restore is faithful) and, only from the «Архів» tab and only with the
address typed back, a real `DELETE` that frees the email. The whole section moved off `/settings`
to admin-only `/users`, with a fourth nav item rendered from the live role. «Власну роль… попросіть
іншого адміністратора» is gone: your own row now carries no controls at all, which says the same
thing without the sentence. Panel-wide, the UA `::marker` is dead in the base layer and
`.admin-disclosure` grew a chevron well, a `::details-content` slide and a danger variant. Driven
locally end to end, including a purge-then-reuse of the same address and a signed-in manager cut
off mid-session by an archive. 259 tests; gate green; not deployed.

**2026-08-06 (session revocation).** Asked to close the hole the users session left open: a changed
password or a disabled account must not leave somebody signed in for hours. Migration `0008` adds
`sessions_valid_from`, the token gains `iat`, and the gate now reads the account row on every
request (`sessionStillValid`) instead of trusting the signature alone — the row rides along in
`locals.adminUser`, so `/settings` stops querying for it. The stamp moves on a password change, an
admin reset, and the active flag changing **either way**; the device doing its own change is
re-cookied so it stays signed in. Driving it caught the bug the first version had: stamping only on
disable let a re-enable inside 12 h resurrect the old token. Legacy tokens without `iat` are
refused, so everyone re-logs in once. Deployed and measured: warm `/orders` median 88 ms. 252 tests.

**2026-08-06 (admin users).** Asked for user creation in the panel, an admin/manager split gating
it, and a password section on `/settings`. Migration `0007` adds `admin_role`; the role is read
from the row per request rather than put in the session cookie, since the cookie is not revocable
and would carry a stale `admin` for up to 12 h — the same read now ends a disabled user's session.
`/settings` grew two sections and moved onto `enhanceAdminForms`. Guards: no self-demote, no
self-disable, and no self-reset from the users list (that path skips the current-password check).
Driving the real screen showed the `last_admin` guard cannot fire from it — the actor is always
another active admin — so the comment says so instead of implying it works. 245 tests; gate green;
`pnpm admin:user` gained `role` and `--role=`, which is also the one manual step after migrating.

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
