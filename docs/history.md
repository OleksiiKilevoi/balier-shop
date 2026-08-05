# HISTORY — balier.ua session log (archive)

> Split out of `docs/STATE.md` on 2026-08-05, when that file passed 1 200 lines and was being
> read in full at every session start. **Nothing here was rewritten** — these are the original
> entries, newest first, covering everything up to the end of Phase 4. (Phase 4's own entries were
> moved across on 2026-08-05, when the phase closed.)
>
> Not loaded automatically. Read it when you need the reasoning behind something already built:
> the Phase 2 storefront, the cart, `/checkout`, both payment methods, the Monobank webhook,
> Turnstile, Telegram, the order-confirmation email, and the whole admin panel — its own login
> form, the orders screens, manual order creation, `/admin/settings` and the catalog editor — plus
> the bugs each of those cost.
>
> Phase 5 onwards stays in `docs/STATE.md`. Move entries here once a phase is finished.

### 2026-08-05 (last) — the catalog becomes editable, and Phase 4 closes

- Did, on request («lets start doing products part for admin panel»): `/admin/products` (list,
  search over title/slug/SKU, status filter, pagination), `/admin/products/new`,
  `/admin/products/[id]` (the editor — text, prices, category, status, variants, images) and
  `/admin/categories`, plus image upload folded in. Supporting: `~/lib/products/slug.ts`,
  `~/lib/validation/catalog.ts`, `~/lib/validation/money.ts`, `~/lib/media/upload.ts`,
  `~/lib/db/queries/adminProducts.ts`, `adminCategories.ts`, `unique.ts`, and
  `components/admin/ProductStatusBadge.astro`. **Six catalog tables had no write path at all** —
  `scripts/seed.ts` was the only thing that had ever made a product, and it only ever
  `onConflictDoNothing`s, so it could not correct itself either.
- **Four decisions asked before any code, all answered with the recommended option:** «content»
  means products + categories (the seven static pages stay `.astro`, the empty `pages` tables stay
  untouched and their body format undecided); upload folded in now; **archive only, never delete**;
  slugs and SKUs auto-suggested and always editable. The roadmap line was one bullet, so this was
  scope, not detail.
- Decided rather than asked, and each for a reason in the schema rather than a preference:
  **create is thin** (`product_images.product_id` is `NOT NULL`, and `draft` already is the holding
  state); **the first variant is made without asking** (a product with none exists and cannot be
  bought); **plain PRG, not `/admin/orders/new`'s fetch layer** — the dead no-script rule made
  script allowed, not required — but **a refusal re-renders with the body** rather than redirecting,
  because this form carries a description somebody wrote; and **no `/api/admin/media`** (a JSON
  endpoint only earns its keep with a script layer driving it), so upload is a plain multipart POST.
- **The last active variant cannot be deactivated**, because `getProductBySlug` returns null for a
  product with none and would 404 a published product without touching its status. The check locks
  **every** variant of the product, not the siblings — locking only the others lets two tabs
  deactivating two different variants each see one remaining and both be right.
- Transliteration is **КМУ 55** with the positional letters (`Київ → kyiv`, `зг → zgh`), and an
  **empty slug is derived on the server**, so the suggestion holds with the script blocked; the
  inline script only previews it. `wholeHryvniaSchema` was lifted out of `codLimitSchema` so the
  ×100 still lives in one place — **the COD limit's ten tests passing unchanged is what proves the
  refactor**.
- **Found by testing against a real database, and nothing else would have found it: Drizzle wraps
  the driver's error.** `code` and `constraint` live on `.cause` of a `DrizzleQueryError`, so the
  first implementation checked the thrown object, found nothing, and turned a duplicate slug into a
  **500** instead of «цей slug зайнятий». Fixed into `queries/unique.ts`, shared by both catalog
  query files, with six tests built from the real error shape — including one for a self-referencing
  cause.
- Also learned, before building on it: **the `IMAGES` binding works under `pnpm dev` and identifies
  format from the bytes** — a `curl -F` upload declared `application/octet-stream` came back
  `image/webp`, 1440×1920. So the guard validates the *decoded* format, not the filename. A corrupt
  file makes `info()` throw and an SVG returns a format with no pixel size, which is why unreadable
  dimensions are a refusal rather than the shrug `readDimensions` takes.
- Verified: `pnpm check` (0 errors)/`pnpm test` (209/209, 57 new)/`pnpm build` clean; **`pnpm
  db:generate` reports «No schema changes»** — no migration was needed; fourteen new utility classes
  grepped out of the built `AdminLayout.*.css` (30.9 KB, up from 24.7) with no storefront token in
  it. Live over curl on the real dev Neon DB, the full lifecycle: draft invisible on all three
  storefront surfaces; published and pricing correctly; a cheaper variant override dropping the card
  price (**`Math.min` proved live**); a real photo stored, served with an immutable header and
  rendered in gallery and grid; **six upload rejections, each with its own message and nothing
  written**; an image moved and the grid thumbnail following; the last-variant guard; duplicate slug
  and SKU; archive → 404; categories created, reassigned and deactivated. Signed-out GET/POST on all
  four routes redirected (**multipart included**) and three cross-site POSTs 403. Built Worker: the
  routes gate correctly and a **real multipart upload and rejection both work**.
- Two harness mistakes worth not repeating: **Git Bash mangles Cyrillic passed inline to `curl
  --data-urlencode`** (the title arrived as `?????`) — write the value to a UTF-8 file and use
  `name@file`; and a line-based `grep -B5` against minified HTML picked the wrong category id, which
  looked like an assignment bug for several minutes and was not.
- **No browser pass** — no CDP tool attached. Four screens functionally verified, visually
  unverified.
- Dev DB: one archived test product and one deactivated test category, both left in place through
  the feature's own archive path; the five seeded products untouched and still active. Throwaway
  admin `qa-catalog@balier.test` disabled after.
- Also: `pnpm preview` crashed again with an empty `[ERROR]` — the stack is entirely inside
  wrangler's `ProxyController`, no app frame. Same flake the previous entry records. It was
  restarted and everything passed.
- Next: **commit and deploy** — Phase 4 is three sessions of unpushed work — then the browser pass.

### 2026-08-05 — the cash-on-delivery limit becomes editable

- Did, on request («lets do the COD limit first», after confirming `/admin/orders` and
  `/admin/orders/new` were walked in a browser and look «good enough»): `/admin/settings` —
  `codLimitSchema` + `adminSettingsSchema` in `~/lib/validation/admin.ts`, `ADMIN_SETTINGS_MESSAGES`
  and `ADMIN_COD_LIMIT_HINT` in `~/lib/i18n/admin.ts`, `getCodLimitSetting`/`setCodLimitKopiykas`
  in `~/lib/db/queries/settings.ts`, the page itself, and the section wired into `AdminLayout`'s NAV
  and the `/admin` home card. **The `settings` table had no writer outside `scripts/seed.ts`.**
- **The unit boundary is the whole point of the schema.** The form is hryvnias, the setting is
  kopiykas, and `codLimitSchema` is the only place a human-entered amount crosses over — a
  factor-of-100 slip there would quietly move the threshold for every customer at once, so the ×100
  happens once and the tests assert exact numbers rather than round-tripping through `hryvnias`.
  Whole hryvnias only; spaces, the NBSP `formatPrice` emits and apostrophes are stripped so a value
  copied off another screen pastes. Bounds 1…1 000 000 ₴ are typo guards, and say so — the panel
  does not know Nova Poshta's real ceiling and must not pretend to.
- **One decision asked** (answered with the recommended option): the screen edits the **amount
  only** — no off switch, no «без обмеження», both of which would need a nullable value and a new
  checkout branch, since the customer-facing message names an amount. So the hint says out loud that
  COD cannot be disabled here; the minimum is not an off switch either, and a manager should learn
  that from the screen rather than by setting the limit to 1 ₴.
- Decided rather than asked: route named `/admin/settings` for the section, not the setting; plain
  PRG rather than `/admin/orders/new`'s fetch layer; `text` + `inputmode="numeric"` rather than
  `type="number"` (`appearance: none` breaks the spinner, and a number input rejects a pasted
  «5 000» before the server sees it); a rejected value is not carried back through the redirect.
  The write is an **upsert with an explicit `updatedAt`** — the seed may never have run on a given
  database, and the column has no `$onUpdate`, so an update that skipped it would report the seed's
  timestamp forever.
- Verified: `pnpm check` (0 errors)/`pnpm test` (152/152, 10 new)/`pnpm build` clean, five new
  utility classes grepped **out of the built `AdminLayout.*.css`** (two apparent misses were my own
  grep patterns forgetting Tailwind's `\.` and `sm\:` escaping, not missing rules) with no storefront
  token in it. Live over curl on the real dev Neon DB: seven bad values refused with the row
  unchanged; 7 500 ₴ saved and read back from `/api/checkout/limits` as `750000`; space/NBSP/
  apostrophe separators accepted; `/admin/orders/new` showing the new ceiling with a real variant in
  the basket; **the row deleted and recreated through the screen, exercising the INSERT half of the
  upsert and the «no row» branch**; signed-out GET/POST redirected and a cross-site POST 403 with
  the limit untouched. Built Worker: `/admin/settings` 303s to the login form, POST included.
- Dev DB left at the seeded 500 000 kopiykas, only `updated_at` moved. Throwaway admin
  `qa-settings@balier.test` created for the pass and disabled after.
- Found, pre-existing: a POST with no `Content-Type` 500s on admin pages —
  `Astro.request.formData()` throws on a body-less request, and `/admin/orders/[orderNumber]` does
  the same. Unreachable from a real form; left alone rather than fixed on one page only.
- Also worth knowing: `pnpm preview` (wrangler 4.118 + miniflare alpha) **crashed with a bare
  `Network connection lost` after two requests** and had to be restarted. Nothing to do with app
  code — the requests it served answered correctly first.
- Next: products and content management, then image upload — the last two Phase 4 items.

### 2026-08-05 (later still) — the delivery pickers become `/checkout`'s dropdown

- Did, on request («make "Населений пункт" and "Відділення або поштомат" behave similar to
  /checkout — i want it to be input with ul listbox, not the way it is right now»): both fields on
  `/admin/orders/new` are now one search box with an absolutely-positioned `<ul role="listbox">`
  under it. The «Не обрано» line and the «Знайти» buttons are gone; each result row is still a real
  submit button carrying its ref, so the picker works with script off exactly as before.
- **The rule that makes a single box work on a server that only sees the body:**
  `isSearchQuery(query, pickedLabel)` — the picked label round-trips as "still picked" (every button
  on the page resubmits the whole form), anything else is a search, and a search un-picks. Typing
  over the city drops the branch with it, which is what `/checkout` does client-side. The branch box
  compares against the row its ref *names*, not the row it is still *allowed* to name, so a
  «відділення» → «поштомат» switch takes the stale label out of the box instead of turning it into a
  query. `pickSettlement`/`pickWarehouse` clear their own query, and that is what closes the list.
- **Branch browse is CSS, not script:** the empty box lists the first 12 branches, and the dropdown
  is `hidden group-focus-within/wh:block` — otherwise every render after picking a city would drop
  an open list over the payment section. Verified in the built CSS that the focus rule lands *after*
  `.hidden` and is more specific, since the whole gate depends on that. Click-away dismissal
  (`pointerdown` → add `hidden`) went into the enhancement layer, matching `/checkout`.
- Verified: `pnpm check` (0 errors)/`pnpm test` (142/142, 5 new)/`pnpm build` clean. Live over curl
  against the real dev Neon DB, seven states — search, pick, **untouched resubmit keeping both
  picks**, typing over each box, a create attempt refused for name/phone only (so the picks survived
  into validation), and both delivery-method switches. **No browser pass** (no CDP tool), and **no
  order created** — nothing in the dev DB changed. The QA account was re-enabled for the curl pass
  and disabled again.
- Next: unchanged — the browser pass over this screen, then the rest of Phase 4.

### 2026-08-05 (later) — `/admin/orders/new` UI fixes, and the end of the no-JS rule

- Did, on request (three complaints: labels overflowing their capsules, the COD-limit warning
  showing regardless of the selected payment method, and «going with no js was an awful idea for
  the admin experience»). Capsules: `admin-badge`'s `max-width: 125px` + `nowrap` was sized for
  status pills; overridden per call site with `w-auto max-w-none` rather than touching the shared
  utility. COD warning (and the card-link hint, and the create button's caption — same latent bug):
  they rendered from `draft.paymentMethod`, the state as of the last *submit*, while radios flip
  without one; all three now render always and CSS picks from the live radio via `group` on the
  form + `group-has-[#pm-…:checked]`.
- **The no-JS rule is formally over for the panel.** `/admin/orders/new` gained an enhancement
  layer: submits become `fetch`es of the byte-identical POST, the response re-renders the form in
  place (focus, caret and keystrokes newer than the response preserved), searches fire debounced as
  the manager types, quantity and delivery-method changes re-render themselves. The server stays a
  pure function of the body; a fetch failure falls back to a real submit; create is flag-guarded
  against racing/repeat and its redirect is followed as a real navigation. The pattern for future
  screens is progressive enhancement, not script-required.
- Named trade: with script the URL never changes, so a mid-draft refresh silently starts over
  (the scriptless «resend?» prompt could restore the draft). In the page's header comment too.
- Verified: `pnpm check` (0 errors)/`pnpm test` (137/137)/`pnpm build` clean; built CSS has the new
  rules with the overrides *after* `.admin-badge` (checked, not assumed — the fix depends on
  cascade order), and the script inlines into the server render, so production still ships no JS
  asset. Live over curl (dev server, real dev Neon DB): search → pick → warehouse box, add-to-basket
  with its quantity input, empty create refused with all field errors. `qa-neworder@balier.test`
  was re-enabled for this (fresh password) and disabled again after. **No browser pass** — the
  fetch layer is untested by an actual click; that browser pass is now first in line next session.
- Next: browser pass over `/admin/orders/new`, then the rest of Phase 4 (products/content
  management, image upload, the COD limit).

### 2026-08-05 — the manager can create an order: `/admin/orders/new`

- Did, on request ("we need an option for admin to create an order — a client contacted via telegram
  and manager needs to create an order"). Flagged first that this is **not in the roadmap** and
  added it to Phase 4 rather than slipping it in. It is a screen over the storefront's own
  `createOrder`, called with exactly the input `/api/checkout` builds — so the repricing, the
  `FOR UPDATE` lock, the reservation, the invoice and the state machine are the code already running
  in production, and `paid` stays webhook-only by construction.
- Four decisions asked rather than guessed: **both payment methods** (card shows the Monobank link
  to paste into the chat, and the 30-minute reservation window was accepted as-is — the link dies
  and the cron cancels the order, which the screen says out loud twice), **query-string draft
  state**, **no oversell**, and **customer email but no manager Telegram message**.
- **Then changed one of them, and said so rather than quietly shipping it:** the draft lives in the
  form's own hidden fields, not the query string. Same shape — every button is a submit, the server
  is a pure function of the body, nothing typed is lost to a round trip — but it keeps customer
  names and phone numbers out of URLs, browser history and Worker logs. The cost is a «resend?»
  prompt on a mid-draft refresh (harmless: the post re-renders the same screen) and a draft that
  only lives in the open tab. Only the create submit redirects (303).
- Decisions made rather than asked: **no `required` attribute anywhere and the email field is a
  `text` input** — browser validation fires on *every* submit, so a required name would refuse to
  let a manager search for a product before typing one; **the branch ref is re-validated against its
  row on every render**, since switching city or «відділення»→«поштомат» leaves a ref naming a real
  place that is no longer a legal answer; **the COD limit is enforced here too**; and
  `payments.page_url` (migration `0005`) rather than `lastPayload`, which **every webhook
  overwrites** — including the `processing` one that lands while the link still matters. That column
  also fixes an older gap: a storefront customer who closed the payment tab was unreachable.
- **Found by building, not by types: Tailwind's `peer-checked:` is a *general sibling* selector.**
  Three radios and three labels in one flex row would light up every label after the checked one;
  one input+label pair per wrapper scopes it. Named peers (`peer/warehouse`) would also work but
  cannot come from a `.map()` — Tailwind only sees static class names. Confirmed by reading the
  generated rule out of the built CSS, along with the `group-has-[#dm-courier:checked]` toggle.
- Verified: `pnpm check` (0 errors)/`pnpm test` (137/137, 18 new)/`pnpm build` clean, storefront
  isolation re-checked in `AdminLayout.*.css`. Live against the real dev Neon DB over curl: a COD
  order (stock 3→1), a card order with a real invoice and its link, a courier order whose
  confirmation email reached the `EMAIL` binding, three field refusals at once, an empty basket, an
  oversell that created nothing (16→17 orders across both), a re-add that bumps rather than
  duplicates, and a branch ref correctly dropped on a method switch. In a built Worker the new route
  redirects to the login form, POST included. **No browser pass** — no CDP tool attached.
- Note for next time: the daemonised `pnpm dev` from an earlier session was serving a **stale Vite
  dep chunk** and 500ing on every route, including `/admin/login`. `astro dev stop` then start
  again. This is the same hazard the 2026-08-05 Turnstile entry warns about, and it is worth
  checking *before* concluding anything from a 500.
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit).

### 2026-08-05 — the deployed login was unopenable: PBKDF2 above the runtime's ceiling

- Reported as two bugs ("correct mail & password says its incorrect", "the incorrect ones are with
  error 500"). One cause: **the Workers runtime refuses PBKDF2 above 100 000 iterations** and
  `DEFAULT_ITERATIONS` was 210 000. `verifyPassword` catches everything and returns `false`, so a
  right password read as a wrong one; `equalizeVerifyTiming` — the timing equaliser for an address
  with no row — had no catch, so the identical throw became a 500. Diagnosed from the Worker's own
  log via `npx wrangler tail balier-dev` (positional, not `--name`), reproduced with curl.
- **The ceiling is a production-only check**, which is exactly why every gate passed: Node, Vite's
  dev server **and `wrangler dev`'s local workerd** all derive 210 000 happily — probed a throwaway
  Worker at 1 000/100 000/100 001/210 000 with this project's `compatibility_date` and flags rather
  than assuming, and all four returned OK. `pnpm preview` would not have caught this.
- Fixed: `MAX_ITERATIONS = 100_000`, `hashPassword` **throws** above it rather than clamping (a hash
  the runtime cannot re-derive locks the account out forever, and the caller is a Node script that
  would never notice), `parse()` rejects an over-cap stored count so a legacy row fails cleanly
  instead of throwing, and `equalizeVerifyTiming` swallows its own failures. **The stored 210 000
  hash had to be reset by hand** (`pnpm admin:user password`) — rehash-on-login can never reach it,
  because the login that would trigger it cannot succeed.
- Named rather than quietly accepted: 100 000 is under OWASP's 600 000, so this **weakens** the
  argument the module's header makes for choosing PBKDF2 at all. Chaining capped derivations buys it
  back at more CPU per login; left open, because the fix's job was to make the panel openable.
- Verified: `pnpm check` (0 errors)/`pnpm test` (119/119, 6 new)/`pnpm build` clean, guards grepped
  out of the built chunk. Live after the 08:37Z deploy: unknown address 200 with «Невірна пошта або
  пароль.», real sign-in works. Also confirmed `ADMIN_SESSION_SECRET` is set and the Zero Trust app
  is gone. Learned: `wrangler tail --status error` misses this class of bug entirely — Astro catches
  the exception and returns its own 500, so the invocation outcome is `Ok`.
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit).

### 2026-08-05 — Turnstile commented out of the checkout form

- Did, on request ("comment out cloudflare turnstile, we don't need it for now — we don't need it in
  the website's order form"): every Turnstile call site disabled behind a `Turnstile:` marker in
  `src/pages/checkout.astro`, `src/lib/validation/checkout.ts` and `src/pages/api/checkout.ts`, plus
  a "currently unused" note on the site key in `wrangler.jsonc`. **Nothing deleted** —
  `src/lib/turnstile/` and its six tests are byte-identical, and both keys stay set, so restoring is
  `grep -rn "Turnstile:" src wrangler.jsonc` and uncommenting.
- Decisions made rather than asked: the `env` import in the checkout frontmatter goes too (the site
  key was its only use, and an unused import fails `pnpm check`); the client's `captcha_failed`
  branch goes with it, since the server can no longer return that; and the schema field is commented
  rather than made optional, because Zod strips unknown keys — a cached client still sending
  `turnstileToken` is accepted, not rejected. Config and secrets are left in place: removing
  `TURNSTILE_SECRET_KEY` from `.dev.vars` would mean a `pnpm cf-typegen` round trip to put it back.
- **Named rather than left to be found: `/api/checkout` now has only the KV rate limiter in front of
  it** (10/min per IP), which is the whole security consequence of this change.
- Verified: `pnpm check` (0 errors)/`pnpm test` (115/115, unchanged — the adapter's own tests still
  pass because the module is untouched)/`pnpm build` clean, with `cf-turnstile`,
  `challenges.cloudflare.com`, `turnstileToken` and `captcha_failed` all **grepped out of `dist/`**
  rather than assumed. Live against the real dev Neon DB: `/checkout` 200 with zero Turnstile
  references in its HTML; a token-less POST carrying a non-existent variant returned `cart_changed`,
  i.e. it reached the repricing layer — past where `captcha_failed` used to stop it — with no side
  effects; then a real COD order with no token succeeded (`B260805-XVFYQ`), success page 200. **No
  browser pass** — no CDP tool attached, so the form without the widget is visually unverified.
- Note for next time: `astro check`/`astro build` re-optimise Vite's deps and leave a running
  `pnpm dev` 500ing on a stale `@neondatabase_serverless` chunk. Restart the dev server after the
  gate, not before.
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit).

### 2026-08-05 — Cloudflare Access out, our own login form in

- Did, on request ("we need to switch from Cloudflare Access to our own auth form"): `admin_users`
  (migration `0004`), `src/lib/auth/` (PBKDF2 password hashing + a signed session cookie),
  `/admin/login` and `/admin/logout`, `pnpm admin:user` to manage accounts, and a rewritten
  `adminGate` in `src/middleware.ts`. `src/lib/access/` and its 18 tests are deleted.
- Four decisions asked rather than guessed, all answered with the recommended option: credentials in
  a Neon table (not one shared secret), a **stateless signed cookie** (not a KV/DB session store),
  **remove Access entirely** (not keep it disabled or chained), and reuse of the existing KV rate
  limiter. The cookie choice is the one with a live cost, and it is named in the docs rather than
  buried: **a session cannot be revoked before its 12 hours are up.**
- Decisions made rather than asked: **no `pnpm dev` bypass** (the form works locally, so the shipped
  path is the exercised one — `dev@localhost` is gone), **`secure: true` even in dev** (`__Host-`
  requires it, and a conditional would make the browser silently discard the cookie locally), and
  **rate limiting inside the login page** rather than the middleware's table, so hitting it can
  answer with the form instead of a bare 429.
- **Found by testing, not by types:** PowerShell prepends a UTF-8 BOM when piping into a native
  command, so the first account was created with U+FEFF glued to its password — correct credentials,
  failing login, nothing in any log. The script strips it now. Also caught before shipping:
  `next=/adminevil` passed a `startsWith('/admin')` check that was meant to mean "inside the panel".
- **Fixed on report, same session: the limiter charged every login attempt, not just failed ones.**
  First real sign-in came back «забагато спроб» — my own curl testing had drained the
  shared dev bucket (`cf-connecting-ip` is absent locally, so every client is `unknown`). Clearing
  the bucket was the smaller half; the design flaw was charging successes at all, which lets an
  operator lock themselves out by signing in. `checkRateLimit` is now composed from `peekRateLimit`
  + `recordRateLimitHit`, and only a wrong password spends budget. Verified: 20 consecutive
  successful logins cost nothing, the 11th *wrong* one blocks, a blocked IP stays blocked even with
  the right password, and another IP is unaffected.
- Verified: `pnpm check` (0 errors)/`pnpm test` (115/115, 23 new)/`pnpm build` clean, with
  `secure: true` and the cookie name grepped out of the *built* bundle and `dev@localhost` absent.
  Live against the dev server on the real dev Neon DB: every gate redirect, 401 JSON for
  `/api/admin/**`, a full login→panel→logout round trip, a tampered-payload cookie refused, five
  open-redirect attempts, two cross-site POSTs 403, the rate limit tripping with its message,
  `lastLoginAt`, and a disabled account refused then re-enabled. **No browser pass** — no CDP tool
  attached, so the login screen is visually unverified.
- Next: deploy blockers first (Worker secret, delete the Zero Trust app, reset the throwaway test
  password), then the rest of Phase 4 — products/content management, image upload, the COD limit.

### 2026-08-04 — the orders status filter becomes a select

- Did, on request ("the status filter is a list of items in a long row, transform it into a good
  looking select and put it on the same row that search is in"): the nine-pill `<nav>` on
  `/admin/orders` is now a `<select name="status">` inside the existing search form. `statusHref`,
  `filterTabs` and the hidden `status` input deleted; form widened `max-w-xl → max-w-3xl` to hold
  three controls, stacking to a column under `sm`.
- Decisions: **`page` is left to reset itself** — a GET submit only carries the form's own fields, so
  the old explicit `delete('page')` had nothing left to do. **The chevron is a sibling `<svg>` in
  `currentColor`**, not a background image, because `appearance: none` (needed for the select to
  match the input) removes the native arrow and `select::after` is not rendered — and a baked-in
  image could not follow the theme. New `admin-select` utility carries only the end-padding, the
  cursor and `text-overflow`.
- **Named the one regression rather than silently fixing it with script:** the pills applied on
  click, the select applies on «Знайти». `onchange`-submit would be a second exception to the panel's
  no-JavaScript rule, and that is the user's call, not a default.
- Verified: `pnpm check` (0 errors)/`pnpm test` (110/110, untouched — markup and CSS)/`pnpm build`
  clean, with `admin-select` grepped out of the built `AdminLayout.*.css` rather than assumed. Dev
  server against the real dev Neon DB: `?status=packed&q=DAMN` renders `selected` on `packed`, all
  ten options, no `?status=` link left on the page. **No browser pass** — no CDP tool attached this
  session, so the layout is unverified visually.
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit).

### 2026-08-04 — the admin panel gets a typeface: Geist

- Did, on request ("use this font for the admin panel: Geist"): added Geist to `astro.config.mjs` as
  a fourth family (`--font-geist`, weights 400/500/600, subsets `cyrillic` + `latin`), a
  `<Font … preload />` in `AdminLayout`, and `--font-sans: var(--font-geist), …` in `admin.css`.
  Config, one tag and two declarations — nothing behind the panel changed.
- This **reverses the panel's "no web font at all" decision** from two sessions ago, and the reversal
  is the point: that rule existed so the panel would carry no business's brand into the next project,
  and Geist passes that test on its own — a neutral interface grotesque, and (checked before
  committing to it, since the whole panel is Ukrainian) it ships a **real Cyrillic cut**, U+0400–045F
  plus U+0490–0491, so ґ/є/і/ї are drawn rather than substituted.
- Decisions made rather than asked: **weights are the three the panel paints** (400/500/600 — nothing
  under `/admin` is bold), so nothing ships that never appears; **both subsets are preloaded**,
  because every screen mixes Ukrainian copy with Latin order numbers and emails; and **the mono stack
  stays the system's** — Geist Mono would pair exactly but is a third font file and was not asked for.
- Verified: `pnpm check` (0 errors)/`pnpm test` (110/110, untouched)/`pnpm build` clean, 6 font files
  (up from 4 — one variable file per subset, shared by all three weights). Isolation re-checked in the
  *built* assets, not assumed: no `--font-geist` in `BaseLayout.*.css`, no storefront token in
  `AdminLayout.*.css` (24.7 KB), and the storefront's HTML mentions Geist nowhere. Live over CDP:
  `document.fonts.check('600 16px …', 'Замовлення')` true with all six faces `loaded`, computed
  `font-family` resolving through `--font-geist` on `<body>` and `<h1>`, Cyrillic measuring wider than
  Arial (so not silently falling back), and the orders list eyeballed at 1280 in both themes and at
  320 (`cssContentSize.width` 320).
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit).

### 2026-08-04 — the theme switch drops its `system` state

- Did, on request ("remove system state from admin panel theme switcher — we only need dark/light"):
  the three-state cycle in `AdminLayout`'s inline script is now a two-state flip. The `system` icon,
  its CSS rule and the `MODES` cycle are gone; `localStorage` is now only ever written, never removed.
- Decision, made rather than asked because it doesn't change what the switch offers: **the operating
  system still decides the *starting* theme.** With nothing stored, `read()` resolves
  `prefers-color-scheme` to `light`/`dark` before the first paint, and a new `change` listener keeps
  following the OS live until the first click — losing that silently would have been a regression for
  the browser that never touches the control. Once a choice is stored, the OS is ignored for good.
- Unchanged: the `light-dark()` palette, `color-scheme` as the only switch, the `startViewTransition`
  cross-fade (`admin-theme-in`, 500ms, old layer held opaque), the `:root:not([data-theme])` rule
  that hides a switch JavaScript cannot drive, and the no-JS fallback to the OS.
- Verified: `pnpm check` (0 errors)/`pnpm test` (110/110, untouched — markup, CSS, one inline script)/
  `pnpm build` clean, and no `system` selector left in `dist/`. Live over CDP: fresh browser + dark OS
  → `dark`, nothing stored; OS flipped live → followed while unstored, ignored once stored; both
  clicks with icon/`aria-label`/both `theme-color` metas tracking; stored `light` beating a dark OS;
  `data-theme` correct at the first animation frame (read from a script injected ahead of the page's
  own) under an opposing OS; the fade still one 500ms `::view-transition-new(root)` animation;
  JavaScript off → no attribute, toggle `display: none`, dark OS honoured.
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit).

### 2026-08-04 — a light/dark switch for the admin panel

- Did, on request ("add a light/dark theme switcher for the admin panel, but make it smooth like a
  0.5s ease transition so it won't hit the eyes"): a three-state switch (system / light / dark) in
  the admin header, cycled by one icon button and remembered in `localStorage`. Flagged up front that
  this ends the panel's "no client-side JavaScript" property, then built it — a chosen theme cannot
  survive a page load without storage. One inline script in `AdminLayout`, no JavaScript asset.
- Decisions: **one palette via `light-dark()`** instead of two blocks swapped by a media query, so a
  colour is written once and `color-scheme` becomes the single switch (`data-theme` on `<html>`
  overrides the OS). Values unchanged. **The script is inline and blocking in `<head>`** so the theme
  is set before the first paint, and **the switch hides itself when JavaScript is off** rather than
  sitting there dead.
- **The fade was rebuilt after measuring the first attempt.** A `transition` on `*` looked right and
  was not: `color` is inherited, so it created a transition on every node — `getAnimations()` showed
  **239** colour transitions vs 22 for `background-color` — each chasing a still-animating parent,
  restarting every frame. Backgrounds landed at 0.5s while text crawled past 1.5s, which is exactly
  the jarring thing the ask was about. Replaced with a single `startViewTransition` cross-fade. Then
  fixed again: the UA's fade leaves both snapshots half-transparent at the midpoint, so a quarter of
  the page showed through grey and text ghosted — now the old page holds fully opaque and the new one
  dissolves over it (which needs `mix-blend-mode: normal`, since the UA sets `plus-lighter`).
- Learned, and worth keeping: **Lightning CSS downlevels `light-dark()`** into a
  `--lightningcss-light/dark` space-toggle polyfill, so dev (native) and production (polyfill) are
  *different mechanisms*. It does rewrite the `:root[data-theme]` rules to match, so the override
  survives — but that had to be checked against the built stylesheet in a harness, because `/admin`
  in a built Worker is correctly 403 and cannot be browsed. Also: probing computed styles right after
  flipping the theme reads buttons mid-transition (they carry their own 0.15s hover timing), which
  looked like two tokens ignoring `data-theme` until it was traced.
- Verified: `pnpm check` (0 errors)/`pnpm test` (110/110, untouched — markup, CSS and one inline
  script)/`pnpm build` clean. Live over CDP against the real dev Neon DB: OS-following live both ways
  without reload, a forced theme beating the opposite OS setting, the full cycle with icon/label/both
  `theme-color` metas tracking, the fade at 517ms with correct endpoints, the stored theme present in
  the **first painted frame**, reduced motion skipping it, 320px (`scrollWidth` 305, header wraps to
  two rows), and JavaScript off → switch hidden, OS honoured. Storefront isolation re-checked in the
  built CSS.
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit).

### 2026-08-04 — the admin panel gets its own, design-agnostic design system

- Did, on request ("this site will be reused across businesses — the reusable parts, the panel
  included, should be built that way; make the admin design-agnostic, simple yet modern, round
  buttons, white light theme, black dark theme, no title fonts from the site"): new
  `src/styles/admin.css`, and `AdminLayout` + `OrderStatusBadge` + all three `/admin` pages rebuilt
  on it. Markup and CSS only — no route, query, schema or validation touched.
- Decisions: **a separate Tailwind build, not extra tokens in `global.css`** —
  `@import 'tailwindcss' source(none)` with `@source` limited to the panel's own three paths, so the
  two stylesheets are separate assets and no page loads both; isolation is enforced by the build
  rather than by discipline. **The accent is the inverted foreground** (black on light, white on
  dark) because a brand hue is exactly what would not survive the move to the next business.
  **Dark theme is `prefers-color-scheme` only** — the panel has no JavaScript, so a toggle could not
  be persisted; one palette re-declared under the media query, plus `color-scheme: light dark` so
  native controls follow. **No web font** — system UI stack, and a mono stack for the strings that
  get compared against another screen (order numbers, SKUs, TTNs, invoice ids). The reusable pieces
  are utilities (`admin-btn` + three variants, `admin-field`, `admin-card`, `admin-badge`,
  `admin-container`) and five `admin-tone-*` named for meaning, not colour, which is what lets
  `OrderStatusBadge` hold no colour value at all.
- Verified: `pnpm check` (0 errors)/`pnpm test` (110/110, untouched)/`pnpm build` clean. Isolation
  checked in the *built* CSS, not assumed: `--color-paper`, `--color-espresso`, `--font-playfair`
  and `container-page` are all absent from `AdminLayout.*.css`, and the storefront home renders
  exactly as before (it still, correctly, ignores a dark OS setting). Live over CDP with
  `prefers-color-scheme` emulated both ways against the real dev Neon DB: list, order detail and
  `/admin` at 1280 light and dark; detail and list at 320 (`cssContentSize.width` 320, no overflow);
  disclosures forced open to see all three button tiers and the `insufficient_stock` banner in dark.
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit),
  now built out of these utilities.

### 2026-08-04 — the TTN field becomes a value with a «Змінити» button

- Did, on request ("make it intuitive"): the Nova Poshta tracking number on
  `/admin/orders/[orderNumber]` was an always-active input among otherwise read-only fields. Wrapped
  it in a `<details>` — the number shows as text (`—` when unset), the input and «Зберегти» appear
  only after «Змінити»/«Додати». Same scriptless disclosure the exits already use, so the panel's
  no-JavaScript property holds. Nothing behind the form changed.
- Decisions: the disclosure re-opens itself when the previous POST came back
  `invalid_tracking_number`, so the fix happens where the error message is; the displayed value is
  hidden while open, since the input directly below already carries it and two copies read as two
  different numbers; and the label was moved out of the `<summary>` because at 320px it wraps and
  pushes the action button between the label and the value it belongs to. The toggle is anchored
  `ml-auto` rather than by `justify-between`, which would have swung it right→left on every click
  once the value hides.
- Verified: `pnpm check` (0 errors)/`pnpm test` (110/110, untouched — markup only)/`pnpm build`
  clean. Live on the dev server against the real dev Neon DB: `B260804-DAMN7` collapsed, expanded
  and at 1280px, `B260804-L6NJG` (no TTN) showing «— … Додати», all screenshotted over CDP with
  `cssContentSize.width` 320 on the narrow shots; a real POST through the revealed form saved
  `59000123456789` with a 303 and was restored to `20450123456789` afterwards. Also confirmed
  Tailwind emits the `group-open:` rules into the built CSS rather than silently dropping them.
- Next: unchanged — the rest of Phase 4 (products/content management, image upload, the COD limit).

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
- **Same session, second follow-up ask: "we also need to revert from refunded back to what it was."**
  This one got a real design discussion first (three questions asked, all answered with the
  recommended option) rather than a quick correction, because it's a different kind of change: no
  existing column records what an order was before `cancelled`/`refunded`, and undoing either has to
  move stock in the direction nothing before this needed to. Added migration `0003`
  (`orders.status_before_exit`, nullable `order_status`), written by `updateOrderStatus` only —
  `create.ts`/`confirmPayment.ts`'s own cancellations (always from `pending`/`awaiting_payment`) never
  touch it, and `revertTarget` only honours the recording when it's `STOCK_COMMITTED`, so those stay
  unrevertable on purpose, same as `pending`/`awaiting_payment` always have been. `updateOrderStatus`
  gained a `leavingExit` branch that locks the relevant `product_variants` rows `FOR UPDATE`,
  re-decrements them, and refuses the whole transaction with a new `insufficient_stock` result if any
  unit has since been sold to someone else. Scoped explicitly to "correcting a mis-click before the
  real Monobank refund was sent" — the button never un-sends money, since nothing here ever called
  Monobank to refund in the first place; says so via `ORDER_REVERT_FROM_REFUNDED_WARNING`. This
  revert sits behind the same `<details>` disclosure as the exits it undoes (unlike the ungated
  packed/shipped/delivered revert above) since it now has a real, failable side effect.
- Verified again: `pnpm check`/`pnpm test` (110/110, 5 more)/`pnpm build` clean, migration applied to
  the real dev Neon DB. Live: refunded `DAMN7` from `delivered` (SPACE stock 3 → 4,
  `statusBeforeExit: delivered`), reverted it back (4 → 3, `statusBeforeExit: null`); zeroed SPACE's
  stock by hand mid-refund and confirmed the revert was refused with `insufficient_stock`, order and
  stock untouched, then restored stock and completed the revert for real; cancelled cod order `BYP3K`
  from `confirmed` (stock 11 → 12) and reverted it back (12 → 11); confirmed pre-migration cancelled
  orders `L6NJG`/`LHB7A` still correctly show no revert option (`statusBeforeExit` is `null` on rows
  that predate the column).
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
  **Superseded on 2026-08-05** — the panel now does hand-roll email+password auth, and this
  paragraph's reasoning is exactly what was traded away. The argument was sound on its own terms and
  the costs it names were all real (all of them got built); what it did not weigh is that a gate
  living in a Cloudflare dashboard cannot be lifted into the next business with the code. Left
  unedited as the record of what was decided here, and why.
- **`workers.dev` is now off.** Adding a `routes` entry makes wrangler disable it by default;
  `balier.mlosko.dev` 404s. Kept that way and made explicit
  (`"workers_dev": false`) rather than left to a default — it was a second public surface no Access
  policy could cover. **Entries in `docs/history.md` that name it as the live test URL are
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
