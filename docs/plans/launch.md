# PLAN — Launch (Phase 5)

## Goal

The store runs on **balier.com.ua**, on the client's own Cloudflare and Neon accounts, with the
client's Monobank merchant, Nova Poshta key and Telegram bot; every page is indexable, the legal
pages are real, one real card payment and one real waybill have gone through, and the client can
run the panel without a developer. Written 2026-09-07 from the repository as it stands at
`ec0797e` (clean tree; `docs/STATE.md` still calls the last two features «uncommitted» — they are
not).

## Where things stand

- Code-complete through Phase 4 + Nova Poshta operations: 329 lib tests, gate green at `ec0797e`.
- **Nothing production exists yet.** Every account is the developer's (Cloudflare, Neon, R2, KV,
  `mlosko.dev`, the Turnstile widget, the NP key). The Sentry org stays ours by decision.
- **Never done, in any environment:** a browser pass through `/checkout`; a real (non-test)
  Monobank payment; a waybill on the client's NP account; a delivered email from a `balier.com.ua`
  sender.
- **The dev cron is broken right now** (found via Sentry, issue BALIER-5, 2 693 events, last one
  minutes ago): its deployed sweep still runs `delete from "stock_reservations"`, a table migration
  `0016` dropped. `pnpm cron:deploy` was owed after `ec0797e` and never ran. Nothing on dev
  cancels a stale card order until it does. Same trap applies at launch — step L4.6.
- **Dev is out of reach (2026-09-07).** The previous developer holds the `mlosko.dev`
  Cloudflare account, the dev Neon project, the dev bot token and the dev NP key; none of it is
  ours to fix or reuse, BALIER-5 included. The wrangler login on this laptop is an unrelated
  account with no balier Workers — never `wrangler deploy` here until L2's login exists.
  Launch is a fresh setup from the repository alone, which is what the plan always said.
- On the client's side only the **`balier.com.ua` domain** exists (registered). No Cloudflare
  account, Neon project, Monobank merchant, NP key or Telegram bot yet.
- Local: `pnpm install` done, 327 lib tests pass, four `.dev.vars` created from the examples
  with **empty values** — fill them as the credentials arrive (they are gitignored). The site
  build needs `CLOUDFLARE_VITE_FORCE_LOCAL=true` on this laptop, because `remote: true` on the
  R2 binding asks the logged-in account for a preview token; Workers Builds is unaffected.

## Phases

Order matters between phases: L1 gates Monobank approval, L2 gates every deploy, L4 is strictly
sequential (schema → secrets → code → data), L6 is the last thing that happens.

### Phase L0 — Decisions [decided 2026-09-07, developer's defaults]

Taken by the developer on the client's behalf, recorded so any of them can be overridden with
one config change. Each one changes a config value or a line of copy.

- **Hostnames:** apex `balier.com.ua` for the store, `admin.balier.com.ua` for the panel. `www` → one
  Cloudflare redirect rule to the apex, added at L6 if the zone gets `www` traffic.
- **Telegram:** a **new bot** created at launch (the dev `balierua_bot` token stayed with the
  previous developer), one new group for notifications. `PUBLIC_TELEGRAM_BOT` and
  `PUBLIC_TELEGRAM_MANAGER` are **blank in the repo** until the bot and the manager account
  exist — blank hides the button / the sign-in section rather than pointing at a stranger.
  The manager handle is the one value only the client can supply.
- **Email sender:** `noreply@mail.balier.com.ua` (subdomain keeps the apex MX free).
- **Turnstile:** off at launch; the KV limiter stays the only bot defence.
- **NP commission:** recipient pays, as the checkout already says («за тарифами
  перевізника»); a personal NP account is enough (COD worked on one in NP-3).
- **Neon:** Launch plan, 7-day PITR.
- **Analytics:** Cloudflare Web Analytics, switched on from the zone dashboard, no code.
- **Photos:** export at 1080×1440 (3:4), WebP, ≤ 300 KB each — one file for card and gallery,
  a third of the dev photography's weight, still sharp on a phone gallery.

### Phase L1 — Content [todo — needs the client]

- [x] Seven static pages written 2026-09-16 from the owner's PDF (`про нас_merged.pdf`, 7 pages):
      `/about` (+ two photos extracted from the PDF into `public/images/`, 1600/1200 px JPEG),
      `/care`, `/delivery`, `/returns`, `/contacts`, `/offer`, `/privacy`. `ContentPlaceholder`
      deleted — nothing imports it. Left out on purpose: the owner's notes-to-self («он у нас есть
      вообще?» on exchange, «АДРЕС И ГРАФИК РАБОТЫ ПИШЕМ?» on contacts) and the eight product
      photos on the care page. Fixed on the way: «поверення», «закордон».
- [ ] **`/offer` and `/privacy` are the Monobank gate** — the merchant is approved against live
      legal pages on the real domain. They must be deployed on `balier.com.ua` (noindex is fine)
      *before* the Monobank application. **Still open in `/offer`: the seller's legal identity is
      in square brackets** — `[повна назва ФОП / компанії]`, `РНОКПП: [номер]`, `Адреса: [адреса]`
      (section 2 and the signature block). Email and phone are filled. Monobank will not accept
      brackets; the owner supplies the values.
- [x] Homepage teasers for `/about` and `/care` rewritten from the real pages.
- [~] `/contacts`: phone `+38 (098) 602-66-26`, `baliershopua@gmail.com`, Instagram. **No address
      or hours** — the owner has not decided whether to publish them; the Telegram manager handle
      is still unknown (L0).

### Phase L2 — The client's accounts [todo — needs the client, or the developer on their behalf]

A full second setup, not a transfer. Only schema and migrations carry over; no data does.

- [ ] **Cloudflare account** (client-owned, developer invited as a member). Add the `balier.com.ua`
      zone, move nameservers at the registrar, wait for **Active** — custom-domain routes fail to
      deploy before that.
      **2026-09-16: the domain is `balier.com.ua`, not `balier.ua`** (which is NXDOMAIN — never
      registered; direct `.ua` names need a trademark). Zone `balier.com.ua` added to the account,
      NS already switched at the registrar to `lia`/`rudy.ns.cloudflare.com`, status **pending**
      until Cloudflare re-checks. The old host (`185.104.45.95`, ukraine.com.ua nginx) serves a bare
      404 — nothing to keep; its apex MX (`mx.ukraine.com.ua`) is untouched by our `mail.`
      subdomain. Decision 2026-09-10: **the owner runs the site — production on the developer's
      own account `52a29667…`**; nothing here is «client-owned» any more.
- [x] **Workers Paid plan** on that account — Email Sending requires it (as on the dev account
      since 2026-08-04). Done 2026-09-16.
- [x] R2: `wrangler r2 bucket create balier-media` (done 2026-09-16, by hand). Empty on purpose — the dev photos are test
      products; real photography goes in through the panel.
- [x] KV: `wrangler kv namespace create RATE_LIMIT` → `5a26a4dd230e4874ad6f3fb8c349bc52` (2026-09-16), in **both**
      `apps/site/wrangler.jsonc` and `apps/admin/wrangler.jsonc` (shared on purpose).
- [x] Email Sending on `mail.balier.com.ua` (2026-09-16). **The CLI answers `2036 Unauthorized`
      to every Email Sending call — even `list` — until the account has onboarded its first
      domain in the dashboard** (Compute & AI → Email Service → Email Sending → Onboard Domain,
      subdomain `mail`, «Add records and onboard»); after that `wrangler email sending list` /
      `dns get` work. Records verified on `lia.ns.cloudflare.com`: MX ×3 + SPF on
      `cf-bounce.mail…`, DKIM `cf-bounce._domainkey.mail…`, DMARC `p=reject`. Test send from
      the CLI — see STATE for the result.
- [x] **Neon project** — `curly-smoke-75808809` («Acelerator», org `org-silent-tooth-80755892`),
      aws-eu-central-1, Postgres 18.6, branch `production`, database `neondb`; linked from the
      repo root with the `neon` CLI (`.neon`, `.env.local`, `neon.ts` — the last is the only one
      git sees). Pooled string copied into the four `.dev.vars` (2026-09-07). **Plan still Free**
      — upgrade to Launch in the console (L0 decision). No extension setup by hand: migration `0006` runs
      `CREATE EXTENSION IF NOT EXISTS pg_trgm` itself.
- [ ] Monobank Acquiring: merchant registration on the client's business, submitted once L1's
      legal pages are live. Until the real token arrives, the test token keeps working on the
      new deployment.
- [ ] Nova Poshta: the client's API key (cabinet → Налаштування → Безпека). The cron's nightly
      sync and the panel's waybills both use it.
- [ ] Telegram: per L0 — the bot token, the notification chat id, the manager handle.
- [ ] Turnstile widget for `balier.com.ua`, only if L0 says on.
- [ ] Sentry stays ours: no new project. Only the environment tag flips (L3).

### Phase L3 — Environment changes in the repository [done 2026-09-07 except the L2 ids]

Made on the working tree at `ec0797e`, uncommitted; the three values that need L2 are marked.
Every dev-scoped value, by file:

- [x] `apps/site/wrangler.jsonc`: `name` → `balier` (a mismatch silently creates a second Worker
      — the sharp edge in OVERVIEW); `routes` → `balier.com.ua`; `ORDER_EMAIL_FROM`;
      `PUBLIC_TELEGRAM_MANAGER` (blank until known); `PUBLIC_TURNSTILE_SITE_KEY` left, unused;
      `SENTRY_ENVIRONMENT` → `production`; the `RATE_LIMIT` KV id — placeholder until 2026-09-16, now the real
      namespace id.
- [x] `apps/admin/wrangler.jsonc`: `name` → `balier-admin`; `routes` → `admin.balier.com.ua`;
      **`SITE_ORIGIN` → `https://balier.com.ua`** (panel-minted invoices point webhook and redirect at
      it — wrong value = card orders from `/orders/new` never reach `paid`); `ORDER_EMAIL_FROM`;
      `PUBLIC_TELEGRAM_BOT` (blank until the new bot exists); `SENTRY_ENVIRONMENT`; the KV id
      (same placeholder).
- [x] `workers/cron/wrangler.jsonc`: `ORDER_EMAIL_FROM`; `SENTRY_ENVIRONMENT`. The name
      `balier-cron` is free on a new account.
- [x] `apps/site/src/middleware.ts:42` — `ADMIN_HOST` is a hardcoded
      `https://admin.balier.mlosko.dev`; the `/admin/**` 301 goes there. Change the string.
- [x] `scripts/telegram-webhook.ts:27` — `DEFAULT_URL` likewise; change it, or always pass the
      URL to `pnpm tg:webhook set`.
- [x] `pnpm cf-typegen` after the var edits (done; found on the way that
      `apps/admin/.dev.vars.example` never listed `NOVAPOSHTA_API_KEY`, so typegen from the
      example dropped it and `pnpm check` would have failed — the example now carries it): `worker-configuration.d.ts` types `ORDER_EMAIL_FROM`
      as the **literal** `"noreply@mail.mlosko.dev"`, so a changed var without regenerated types
      fails `pnpm check`.
- [x] Turnstile stays commented out (L0).
- [ ] **Not yet:** `SITE_IS_INDEXABLE` in `apps/site/src/layouts/BaseLayout.astro:20` stays
      `false` until L6.
- [x] `pnpm check && pnpm build` green (build with `CLOUDFLARE_VITE_FORCE_LOCAL=true` here).
      **Committed 2026-09-10 as `2adbb7e`** — **do not push to `main` while the previous developer's Workers Builds may
      still watch it**: the renamed Workers and `balier.com.ua` routes would fail their build,
      harmlessly, but it is noise on an account we do not control. The Monobank webhook URL needs no change — `createOrder`
      builds it from the request origin (`apps/site/src/pages/api/checkout.ts:75`), and
      `astro.config.mjs` already has `site: 'https://balier.com.ua'` for canonical/OG.

### Phase L4 — Stand it up, in this order [todo]

1. [x] Root `.dev.vars`: `DATABASE_URL` = the new Neon pooled string. `pnpm db:migrate` — all
       nineteen migrations, `0000`–`0018`. **Done 2026-09-07:** 19 applied, 17 tables, `pg_trgm`
       present, `in_stock` / `weight_grams` / `arrived` verified by query. **Do not run `pnpm db:seed`**: it inserts the synthetic
       and test products. The two settings it would seed (`cod_limit` 5 000 ₴,
       `payment_ttl_minutes` 30) have code defaults and `/settings` writes them as an upsert.
2. [ ] `pnpm admin:user create <client email> --role=admin` against that database (no admins
       there — checked 2026-09-10). Also one for
       the developer, `disable`d after handover if the client prefers. (STATE.md's rule: the
       gate reads `sessions_valid_from`/`archived_at` on every request — schema **before** panel
       code, which step 1 guarantees.)
3. [x] First deploy by hand from each directory, so the Workers and routes exist:
       `pnpm deploy:site`, `pnpm deploy:admin`, `pnpm cron:deploy`. DB-backed routes 500 until
       step 4 — expected, nothing is indexable or linked yet.
       **2026-09-16:** `balier` uploaded (version `c8186822`) but its custom domain failed with
       `100117: Hostname 'balier.com.ua' already has externally managed DNS records` — the zone
       import carried the old hosting's proxied A/AAAA for the apex plus a wildcard `*`, so every
       hostname (admin included) still hits the dead ukraine.com.ua nginx (302 loop). Fix: delete
       every A/AAAA/CNAME in the zone (apex, `www`, `*`), keep the apex MX + SPF TXT and the
       `mail.`/`cf-bounce.`/`_dmarc.` records, redeploy all three. Two side effects of the first
       deploy: **wrangler auto-provisioned a KV namespace `balier-session` (`f376dc06…`) for the
       Astro Cloudflare adapter's default `SESSION` binding** — nothing in the site uses
       `Astro.session`, it is empty and free, left alone (the admin deploy will make a second one);
       and wrangler rewrote `apps/site/wrangler.jsonc` with tabs and expanded arrays, content
       unchanged — reverted with `git checkout`, expect it again on every hand deploy.
       **Done 2026-09-16 13:17–13:22 UTC after the DNS cleanup:** `balier` (852feeb8),
       `balier-admin`, `balier-cron` all exist; custom domains `balier.com.ua` → `balier`,
       `admin.balier.com.ua` → `balier-admin`; cron schedules `*/15` + `0 4` registered; a second
       auto-provisioned KV `balier-admin-session`. Verified through the edge (`curl --resolve` to
       `188.114.96.11` — macOS's mDNSResponder kept the old hosting IP cached long after `dig`
       showed Cloudflare, which made the apex look like it still served the old nginx and its
       `default-ssl.default-host.net` cert): `/about` `/offer` `/contacts` 200, images 200, 404
       page 404, `/` and `/products` 500 (no `DATABASE_URL` yet), `admin…/login` 200. Universal
       cert (GTS, `balier.com.ua` + `*.balier.com.ua`) active.
4. [ ] Secrets, `wrangler secret put <NAME>` **from each Worker's directory** — they are
       per-Worker and do not carry over. Each `put` redeploys the same code with the secret.
       - `apps/site`: `DATABASE_URL`, `MONOBANK_TOKEN` (test token until Monobank approves),
         `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; `TURNSTILE_SECRET_KEY` if on.
       - `apps/admin`: `DATABASE_URL`, **fresh** `ADMIN_SESSION_SECRET`
         (`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`),
         `MONOBANK_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NOVAPOSHTA_API_KEY`.
       - `workers/cron`: `DATABASE_URL`, `NOVAPOSHTA_API_KEY`, `MONOBANK_TOKEN`,
         `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Without `MONOBANK_TOKEN` the sweep fails closed
         and never cancels an unpaid order.
       - Verify with `wrangler secret list` in each directory — count, not assumption.
5. [ ] Workers Builds: connect the GitHub repo to `balier` and `balier-admin` in the client's
       dashboard, mirroring the dev account's two Builds configs (per-app root directory and the
       path filter — the settings live only in the dashboard, so read them off `balier-dev` /
       `balier-admin-dev` before they are gone). Sentry sourcemap upload: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
       `SENTRY_PROJECT=balier` in the **Build** variables section, not runtime Variables (the
       2026-08-09 trap). Reminder from OVERVIEW: plaintext dashboard variables do not survive a
       push — everything runtime is either in `wrangler.jsonc` `vars` or an encrypted Secret.
       The cron never goes through Builds; it is `pnpm cron:deploy`, always.
6. [ ] **Nova Poshta dictionaries.** `np_settlements` / `np_warehouses` are empty on a fresh
       database and `/checkout`'s pickers render nothing until they are filled. Run
       `pnpm np:sync` from the laptop (root `.dev.vars` needs `NOVAPOSHTA_API_KEY`) rather than
       waiting for the 04:00 cron. ~80 k rows, a few minutes.
7. [ ] `pnpm tg:webhook set https://admin.balier.com.ua/telegram/webhook` — Telegram allows one
       webhook per bot, so this **moves the bot off the dev panel**; dev OTP sign-in stops
       working from that moment. Then `pnpm tg:webhook info` to confirm.
8. [ ] Sign in at `admin.balier.com.ua`. `/settings`: link the client's Telegram account (OTP
       sign-in), «Підтягнути з акаунта» for the NP sender, pick the **real handover branch**
       (dev still says Київ, Відділення №1 as a placeholder), sender phone, default seat
       dimensions and cargo description, COD limit.
9. [ ] Catalog — **drafted in `docs/plans/catalog.md`** (17 products from the client's 130
       photos, copy + market prices, 2026-09-07) and loaded by script once approved, not by hand;
       weight on every variant (NP refuses a waybill without it, by design no default), photos at
       the L0 size, «featured» flags for the homepage row (limit 4).
10. [ ] Email Sending smoke test from the deployed Worker: a COD order with the client's own
        email through `/checkout`, confirmation delivered.

### Phase L5 — Verification pass [todo]

What has to be *seen*, not deduced. Use a real phone for the 320 px checks.

- [ ] **Storefront**: home, `/products`, a product page (gallery, variant switch, «Замовити через
      Телеграм» opens the right chat with the prefilled text), category page, `/search` in all
      three states, all seven static pages, 404. OG tags on a product page (share it into
      Telegram and look at the preview).
- [ ] **Cart**: add, change quantity, sold-out line dropped with a notice, persists across reload.
- [ ] **`/checkout` in a browser — the pass that has never happened.** Settlement and branch
      pickers (search, chips, keyboard), phone mask, COD over the limit refused with the amount
      in the message, both payment methods, success and failure pages.
- [ ] **Card money path with the real token** once Monobank approves: a real order for the
      cheapest item, pay it, watch the order reach `paid` (webhook, not the success page), the
      «Оплачено» Telegram message and the email; then refund it in Monobank's dashboard and mark
      it `refunded` in the panel.
- [ ] **COD path end to end**: order → «Створити ТТН» on the client's account → «Друк
      маркування» PDF → register on `/registers` → print → then delete the register and the
      waybill (NP has no sandbox; create-then-delete is the test). Watch the next */15 tick
      detach nothing and alert nothing.
- [ ] **Cron alive**: after 15 minutes, Workers Logs for `balier-cron` show the sweep and the
      tracking tick completing; **Sentry shows no BALIER-5-style query error under
      `environment:production`**. After the first 04:00, the NP sync reports 0 rewritten rows on
      an unchanged feed.
- [ ] **Rate limiter**: eleven `/api/checkout` POSTs in a minute from one IP → 429 with
      `retry-after`. Webhook route is *not* limited (a forged POST gets 403, never 429).
- [ ] **Panel**: password login, OTP login, wrong password ×10 → the login budget message, a
      manager account sees no `/users`, order edit locks after a waybill, status revert paths,
      image upload through the real form (the curl-vs-FormData rule), `/settings` saves.
- [ ] **Sentry**: one deliberate error per Worker (or the first real one) arrives tagged
      `worker:site|admin|cron`, `environment:production`, with readable frames from the uploaded
      maps — the cron's release-based matching was the one unverified piece.
- [ ] **Neon**: confirm the PITR window on the plan chosen, and do one restore-to-branch to prove
      the backup is usable.
- [ ] `docs/STATE.md` dev-DB list of QA rows: none of it exists on the new database — check the
      admin list shows only the accounts from L4.2.

### Phase L6 — Go live [todo]

- [ ] `MONOBANK_TOKEN` swapped to the real one on **all three** Workers (site mints at checkout,
      admin mints from `/orders/new`, cron reconciles) — one forgotten Worker means orders that
      can never be paid or never get cancelled. Then L5's real-payment check.
- [ ] `SITE_IS_INDEXABLE = true`, push. Every page currently ships `noindex, nofollow`.
- [ ] `www` redirect rule if L0 says so; Cloudflare Web Analytics on if L0 says so.
- [ ] Training session with the client on the panel: orders and their statuses (forward moves
      are the carrier's, only «Створити ТТН» and revert/cancel are theirs), waybills and the
      register, products/variants/`in_stock`, `/settings`, `/users`, what the Telegram messages
      mean, what to do when a payment lands on a cancelled order (refund alert).
- [ ] Instagram bio link → `balier.com.ua`.
- [ ] Handover notes: which account holds what, where each secret lives, how to rotate
      `ADMIN_SESSION_SECRET` (signs everyone out), `pnpm admin:user` for recovery.

### After launch — dev teardown [todo, not blocking]

- [ ] BALIER-5 (the dev cron throwing every 15 minutes into the shared Sentry project) is the
      previous developer's to fix; ask them to redeploy or delete `balier-cron`, or resolve the
      Sentry issue with a note once production is tagged and the dev noise can be filtered by
      `environment:development`.
- [ ] Decide whether `balier-dev` / `balier-admin-dev` stay as a staging environment. If they
      stay: they need their own bot (the webhook moved), and the old cleanup still applies
      (`CF_ACCESS_*`, stray `ADMIN_SESSION_SECRET` / `NOVAPOSHTA_API_KEY` on `balier-dev`).
- [ ] Move roadmap Phase 5 to `[x]`, move this plan's log to `docs/history.md`, update
      `OVERVIEW.md`'s dev URL and the «Cloudflare bindings and accounts» section.

## Open questions

- Everything in L0. None of it is a guess the code can absorb; each maps to one value.
- **Telling the customer when an order moves** (shipped/cancelled) — recorded unresolved since
  Phase 4. Not launch-blocking, but the client should decide it knowingly: today a customer
  learns of a shipment only from Nova Poshta's own SMS.
- **`confirmPayment` does not compare the paid amount** against the order total (2026-08-05
  audit note). Low risk (Monobank charges the invoice amount we set), recorded, not built.

## Out of scope (for now)

- Phase 6 items: sitemap/robots/JSON-LD, CSV export, admin action log, i18n, email campaigns,
  customer accounts. A `robots.txt` is trivial but pointless until L6 flips indexing; the
  canonical tag already exists.
- Image resizing — decided against 2026-08-03; the L0 export-size agreement is the substitute.
- Moving Sentry — stays on our org by the 2026-08-09 decision.
