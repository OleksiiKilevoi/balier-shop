# STATE — balier.ua

> Single source of truth for "where did we stop". Read aloud at session start.

## 📍 CURRENT STATE (overwrite this block; keep tight)

- **Last done:** the catalog became editable — `/admin/products` (list + editor),
  `/admin/categories` and image upload. The last two items of Phase 4, so **the phase is closed**.
  Six catalog tables that had no write path outside `scripts/seed.ts` now have one; archive only,
  never delete. `pnpm check` / `pnpm test` (209/209) / `pnpm build` clean and the whole lifecycle
  verified over curl against the real dev Neon DB; **no browser pass**. Full account in
  `docs/history.md`.
- **In progress:** nothing — Phase 4 is complete and **none of it is deployed**. See «Active branch».
- **Next step:** **commit and deploy Phase 4** — three sessions of unpushed work
  (`/admin/orders/new`, `/admin/settings`, the catalog screens, migration `0005`). Then a **browser
  pass** over the four screens nobody has ever looked at: `/admin/products`, its editor,
  `/admin/categories` and `/admin/settings` — all functionally verified over curl, all visually
  unverified, and the product editor is the largest screen in the panel by some way. Then Phase 5.
  (`/admin/orders` and `/admin/orders/new` were walked in a browser on 2026-08-05, «good enough».)
- **Rules that bind any future panel screen:**
  - Build out of `src/styles/admin.css`'s utilities (`admin-btn*`, `admin-icon-btn`, `admin-field`,
    `admin-select`, `admin-textarea`, `admin-card`, `admin-badge`, `admin-tone-*`). A storefront
    token under `/admin` is a bug, not a shortcut — `source(none)` means it would silently compile
    to nothing anyway — and **a new component must live under `src/components/admin/`** or its
    classes compile to nothing for the same reason. Colours go in as `light-dark()` pairs on a
    token; nothing reads `prefers-color-scheme` directly, or it ignores the theme switch.
  - **The no-script rule is dead as of 2026-08-05.** The replacement is progressive enhancement: the
    form must work as a plain form, and script may make it better on top. The catalog screens take
    the plain-PRG end of that; `/admin/orders/new` takes the reload-free end. Requiring script is
    not legitimate. (`docs/CONVENTIONS.md` may still word the old rule.)
- **Still worth carrying:**
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
  - **Email Sending DNS records are not added yet.** Sending is enabled on `mail.mlosko.dev`
    (tag `1d4ba47f…`, DKIM selector `cf-bounce`, return path `cf-bounce.mail.mlosko.dev`), but the
    six records it needs — three MX on `cf-bounce.mail`, SPF, DKIM, DMARC — must be created in the
    zone by hand; `wrangler email sending dns get mail.mlosko.dev` prints them exactly. Until they
    exist, order emails keep failing closed.
  - Phase 0 externals unchanged: Monobank Acquiring registration, Nova Poshta business account +
    cash-on-delivery setup, Telegram manager account / bot / chat.
  - `PUBLIC_TELEGRAM_MANAGER` in `wrangler.jsonc` is a **placeholder handle**.
  - Small cleanup: `wrangler secret delete CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` — both are still
    set on the Worker and read by nothing since the auth switch.
  - Dormant, not resolved: the Turnstile widget (`0x4AAAAAAEF8vF0-cXNWdOOY`) was created when
    `localhost` and the `workers.dev` URL were the only allowed hosts, so its hostname allowlist may
    not include `balier.mlosko.dev`. Never tested either way; it matters again the moment Turnstile
    is uncommented.
- **Active branch:** `main` (only branch; tracks `origin/main`). `origin/main` is at `6fd8c5f` —
  the auth switch, Turnstile and the iteration fix are pushed and therefore deployed. **Everything
  since is uncommitted: the order-creation screen, `/admin/settings`, the whole catalog side, and
  migration `0005`.** So the deployed Worker has the login form and nothing else from Phase 4 — the
  panel a visitor to `balier.mlosko.dev` finds today is three sessions behind this file. The
  migration *is* already applied to the dev Neon DB, which is the safe order. A push to `main`
  deploys (Workers Builds on `mykhailoshulezhko/balier`, production branch `main`, `pnpm run build`
  → `npx wrangler deploy`) and it is **not instant** — `npx wrangler deployments list` shows when a
  version actually landed.
- **Dev DB state (real rows, harmless, deliberately not cleaned up):** ten orders. From the Phase 3
  and admin passes: `B260805-XVFYQ` (COD, placed by curl with no captcha token — the proof Turnstile
  is off), `B260804-6DN8Q` (card, paid through the real webhook), `B260804-BYP3K` / `B260804-S86Y7`
  (COD), `B260804-DAMN7` (walked all over by the admin screens — `delivered`, fake TTN
  `20450123456789`), and `B260804-L6NJG` / `B260804-LHB7A`, `cancelled` from before migration `0003`
  so they correctly offer no revert. From the panel's own create screen: `B260805-67RJB` (COD,
  `confirmed`), `B260805-A88BY` (card, `awaiting_payment`, real Monobank invoice) and
  `B260805-BLF43` (COD courier with an email address — the one that proves the confirmation email
  fires on that path). From the catalog session, the first rows the *panel* created: product
  `sumka-test-liunet` left **archived** (two variants, three images) and category
  `testova-katehoriia` left **deactivated** — archived rather than deleted on purpose, since
  archive-only is the rule the feature ships. The five seeded products are untouched and all
  `active`. **`admin@balier.com` is the only enabled admin account.**

## ✅ Phase tracker (high-level; detail in docs/plans/roadmap.md)

- [~] Phase 0 — Preparation (Neon + R2 done; Monobank, Nova Poshta, Telegram outstanding)
- [x] Phase 1 — Foundation (schema, migrations, seed, design components, deploy verified)
- [~] Phase 2 — Catalog / storefront (every page built; static-page copy outstanding)
- [~] Phase 3 — Cart and payment (code-complete: cart, `/checkout`, both payment methods, Turnstile
      (built, then commented out on request — the code stays), the webhook, both Telegram
      notifications, rate limiting, the confirmation email, `balier-cron` deployed. Only
      non-code items remain: the Email Sending DNS records, and a live browser `/checkout` pass)
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
