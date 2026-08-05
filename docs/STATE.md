# STATE — balier.ua

> Single source of truth for "where did we stop". Read aloud at session start.

## 📍 CURRENT STATE (overwrite this block; keep tight)

- **Last done:** **Cloudflare Turnstile is commented out of the checkout form.** On request ("we
  don't need it for now"). **Commented, not deleted** — `src/lib/turnstile/index.ts` and its six
  tests are untouched, `TURNSTILE_SECRET_KEY` and `PUBLIC_TURNSTILE_SITE_KEY` stay set, and every
  disabled block carries a `Turnstile:` marker so `grep -rn "Turnstile:" src wrangler.jsonc` finds
  all of them at once. Four files: `src/pages/checkout.astro` (the `env` import — its only use — the
  site key, the widget `div`, the `api.js` tag, the `window.turnstile` global, the token read and its
  «Пройдіть перевірку безпеки» guard, `turnstileToken` in the payload, the `resetTurnstile()` call
  and the `captcha_failed` branch), `src/lib/validation/checkout.ts` (the `turnstileToken` field),
  `src/pages/api/checkout.ts` (the import and the verify block) and a "currently unused" note in
  `wrangler.jsonc`.
  - **The rate limiter is now the only bot defence on `/api/checkout`** (10/min per IP,
    `src/middleware.ts`) — said here rather than left to be rediscovered. Zod strips unknown keys, so
    a cached client still sending `turnstileToken` is accepted, not rejected.
  - **This unblocks two things.** The Phase 3 leftover "a real browser pass through `/checkout`
    (Turnstile-gated, so curl can't do it)" is no longer gated — curl can now drive the whole order
    path. And the open blocker "the Turnstile widget's hostname allowlist may not include
    `balier.mlosko.dev`" is **dormant**, not resolved: it comes back the moment this is uncommented.
  - `pnpm check` (0 errors)/`pnpm test` (115/115, unchanged — the adapter's own tests still pass
    because the module is untouched)/`pnpm build` clean, with `cf-turnstile`,
    `challenges.cloudflare.com`, `turnstileToken` and `captcha_failed` all grepped out of `dist/`
    rather than assumed. Live on the dev server against the real dev Neon DB: `/checkout` 200 with
    zero Turnstile references in its HTML; a token-less POST to `/api/checkout` carrying a
    non-existent variant came back `cart_changed` — i.e. it reached the repricing layer, which is
    past where `captcha_failed` used to stop it, with no side effects; then a **real cash-on-delivery
    order with no token at all succeeded**, `B260805-XVFYQ`, success page 200. **Not eyeballed in a
    browser** — no CDP tool attached, so the form's new layout without the widget is visually
    unverified.
  - The dev server had to be restarted first: `astro check`/`astro build` re-optimise Vite's deps and
    left the running one 500ing on a stale `@neondatabase_serverless` chunk. Not caused by this
    change, but it will happen again.
- **Before that:** the admin panel got **its own login form** — PBKDF2 + a signed session cookie in
  `src/lib/auth/`, `admin_users` (migration `0004`), `pnpm admin:user`, and a rewritten `adminGate`;
  Cloudflare Access and `src/lib/access/` are deleted. Full account in the session log below and in
  `docs/OVERVIEW.md`. **The one cost worth carrying forward: a session cannot be revoked before its
  12 hours are up** — rotating `ADMIN_SESSION_SECRET` is the only way to end all of them at once.
- **In progress:** **Phase 4 — the admin panel.** The gate is done — now the panel's own login form
  (see the top entry) — and orders are done. What is left of the phase: **products and content
  management**, **image upload** via `storeImage`, and the **cash-on-delivery limit**
  (`settings.cod_limit` is read at checkout already; nothing writes it). All three are developed
  against `pnpm dev`, which **no longer bypasses the gate** — sign in with the account
  `pnpm admin:user create` made, and
  all three should be built out of `src/styles/admin.css`'s utilities (`admin-btn*`,
  `admin-icon-btn`, `admin-field`, `admin-select`, `admin-card`, `admin-badge`, `admin-tone-*`) — a
  storefront token
  appearing under `/admin` is now a bug, not a shortcut, and `source(none)` means it would silently
  compile to nothing anyway. Colours go in as `light-dark()` pairs on a token; nothing should read
  `prefers-color-scheme` directly, or it will ignore the theme switch. The no-script rule still
  stands for *behaviour* — the theme switch is the one sanctioned exception, and image upload is the
  next item likely to argue for another.
  Deliberately *not* built with orders, and unasked-for so far: any customer-facing notification on
  an admin status change — «Відправлено» emails are not in the roadmap item, so Telegram and email
  stay wired to order creation and payment only.
  Phase 3 is **code-complete**; what's left there is not code — a domain for Email Sending, and a
  real browser pass through `/checkout` (**no longer Turnstile-gated**, so curl can drive it now —
  and did, this session). Phase 2 still
  carries its own leftover: the seven static pages render a heading, a lead and a
  `ContentPlaceholder`. Writing them is a Phase 5 content item, and the legal ones gate Monobank.
- **Next step:** the rest of Phase 4 — products/content management and image upload, or the
  cash-on-delivery limit (much the smaller of the two, and it closes a checkout setting that is
  currently read-only). (Still open from Phase 3, unchanged: a real browser checkout pass, COD with
  an email address, to watch the confirmation email attempt and its graceful
  `E_SENDER_NOT_VERIFIED` failure.)
- **Blockers (waiting on me):**
  - **Three things the auth switch needs, all mine, none of them code — and it is now *already
    deployed*, so these are urgent rather than pre-flight:**
    1. **`wrangler secret put ADMIN_SESSION_SECRET --name balier-dev`** — the deployed Worker has no
       value for it, and until it does every `/admin` request there is denied (correct failure
       direction, but the panel is unopenable). Generate 48 random bytes; **not** the same value as
       the local one in `.dev.vars`.
    2. **Delete the Zero Trust application in front of `balier.mlosko.dev`.** Until it goes, both
       gates are chained: a one-time PIN *and* a password for every login. Also
       `wrangler secret delete CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD --name balier-dev`, which are
       now read by nothing.
    3. **Create the real admin account against whatever DB the deployment uses** —
       `pnpm admin:user create <email> <name>`. Today that is the same dev Neon DB, which already has
       `lxstspxrk@gmail.com`; **its password is a throwaway I set for testing, so reset it**
       (`pnpm admin:user password lxstspxrk@gmail.com`).
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
    - ~~**The Turnstile widget's hostname allowlist may not include `balier.mlosko.dev`.**~~ —
      **dormant since 2026-08-05**, not resolved: Turnstile is commented out, so nothing calls the
      widget. It comes back the moment it is uncommented. The widget (`0x4AAAAAAEF8vF0-cXNWdOOY`)
      was created when `localhost` and the `workers.dev` URL were the only hosts; if checkout on the
      new domain ever returns `captcha_failed`, this is why — add the hostname in the Turnstile
      dashboard. Never tested either way.
  - `PUBLIC_TELEGRAM_MANAGER` in `wrangler.jsonc` is a **placeholder handle**.
  - ~~`DATABASE_URL` missing as a Worker secret~~ — resolved; it is set, and as of 2026-08-04 so are
    the other five runtime secrets.
- **Dev DB state (real rows, harmless, deliberately not cleaned up):** `B260805-XVFYQ` (cash on
  delivery, placed by curl with no captcha token — the proof Turnstile is off), `B260804-6DN8Q`
  (card, paid through the real webhook), `B260804-BYP3K` / `B260804-S86Y7` (cash on delivery), and
  `B260804-DAMN7`, which the admin screens have been walked all over — it is `delivered` with the
  fake TTN `20450123456789`. `B260804-L6NJG` and `B260804-LHB7A` are `cancelled` from before
  migration `0003`, so they correctly offer no revert. One admin account: `lxstspxrk@gmail.com`.
  The Phase 3 money path was verified live against this data — COD end to end, the strict
  `cart_changed` rejection rolling back with zero side effects, and card payment including the
  `paid` transition and webhook idempotency. Full accounts in `docs/history.md`.
- **Active branch:** `main` (only branch; tracks `origin/main`). Local `main` and `origin/main` are
  both at `7e6f936` — **the auth switch has been pushed, and therefore deployed.** The Turnstile
  change above is **uncommitted** on top of that, so it is not.
  A push to `main` deploys (Workers Builds is connected to `mykhailoshulezhko/balier`, production
  branch `main`, build `pnpm run build`, deploy `npx wrangler deploy`) — **do not push the auth
  switch before the three blocker items above are done**, or the deployed panel locks itself out.

## ✅ Phase tracker (high-level; detail in docs/plans/roadmap.md)

- [~] Phase 0 — Preparation (Neon + R2 done; Monobank, Nova Poshta, Telegram outstanding)
- [x] Phase 1 — Foundation (schema, migrations, seed, design components, deploy verified)
- [~] Phase 2 — Catalog / storefront (every page built; static-page copy outstanding)
- [~] Phase 3 — Cart and payment (code-complete: cart, `/checkout`, both payment methods,
      Turnstile (built, then **commented out on request 2026-08-05** — the code stays), the webhook,
      both Telegram notifications, rate limiting, and now the order-
      confirmation email. `balier-cron` is deployed. Only external/non-code items remain: onboarding
      a domain for Email Sending, and a live browser pass through `/checkout`. The admin COD-limit
      UI is Phase 4's item, not this one)
- [~] Phase 4 — Admin panel (the gate is the panel's own login form — PBKDF2 + signed session cookie,
      fail-closed, built and verified live; it replaced Cloudflare Access. The orders screen — list,
      detail, transitions, TTN — is done and verified live. Products and content management, image
      upload and the COD limit are unstarted)
- [ ] Phase 5 — Launch (incl. migrating off the dev Neon/Cloudflare accounts)
- [ ] Phase 6 — Improvements

---

## 🗒️ SESSION LOG (newest first; 3–6 lines each)

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
  Mykhailo's first real sign-in came back «забагато спроб» — my own curl testing had drained the
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
  `balier-dev.mykhailoshulezhko.workers.dev` 404s. Kept that way and made explicit
  (`"workers_dev": false`) rather than left to a default — it was a second public surface no Access
  policy could cover. **Entries in `docs/history.md` that name it as the live test URL are
  historical**; the live dev URL is `https://balier.mlosko.dev`.
- Next: `/admin/orders` — list, detail, and the status transitions the order state machine allows.

> Everything older than this — the whole of Phases 2 and 3 — is in **`docs/history.md`**. Moved on
> 2026-08-05, not rewritten, because this file is read in full at every session start and had reached
> 1 286 lines. Move a phase's entries across once the phase is done.
