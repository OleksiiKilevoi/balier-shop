# STATE — balier.ua

> Single source of truth for "where did we stop". Read aloud at session start.

## 📍 CURRENT STATE (overwrite this block; keep tight)

- **Last done (2026-10-02): SEO markup fixes from a Jev audit — deployed** (`9772c30`,
  `8428941`, version `15ba751b`). Homepage `<h1>` (sr-only), titles via `pageTitle` and
  descriptions via `clampDescription` (`packages/lib/src/seo.ts`), per-page meta on the content
  pages, `<h2>` catalog cards, CollectionPage / BreadcrumbList JSON-LD, `<lastmod>` on product
  sitemap URLs. The previous entry (banner, 2026-09-29) is in the session log below — its code
  is deployed but **still uncommitted**, as are the admin/settings changes beside it.
- **The shop is open and has taken a real order.** `balier.com.ua` indexable since 2026-09-18,
  Search Console verified with the sitemap submitted; 23 active products / 57 variants, one paid
  order through the production Monobank merchant (card, with a promo code applied). Live since
  the last entry: `/palette`, `/personalization`, `/corporate` from the owner's PDFs; category
  nav on the catalog; the cream background; **parcel size «до 2 кг» / «до 10 кг» replacing the
  per-variant weight** (migration 0020 — the old scheme blocked a waybill on 26 of 28 variants);
  the **e-mail promo** (popup after a minute, one code per address, one order per code, switched
  on at 10 %); **«Клієнти»** in the panel; SEO and AI basics (canonical fix, `robots.txt`,
  `/sitemap.xml`, `/llms.txt`, Product + Organization JSON-LD, 301s off the 2019–2025 site).
  Nova Poshta sender now matches the live API key, so waybills work.
- **In progress:** nothing running. Offered and not started: a product feed for Google Merchant
  and Meta, the Meta pixel, UTM attribution on orders, campaign promo codes (one code for
  everyone with a use limit) — `~/.claude/plans/` holds the sketch for the first three.
- **Next step:** owner's call on the open items below; otherwise the shop is complete and selling.
- **Blockers / owner's decisions:**
  - Prices and model names from `docs/plans/brand.md` (Instagram says the travel bag is 15 500,
    most bags 4 200–5 500, and five lines are missing) — production untouched, the owner's call.
  - Turnstile stays commented out on `/api/checkout`; a 5-per-300 s per-IP budget is the only bot
    defence on the endpoint that creates orders and calls Monobank.
  - Cloudflare → Security: confirm WAF and bot protection are on (the only audit item not checked).
  - Search Console (looked 2026-10-15): 37 indexed. «Обнаружена, не проиндексирована» holds 19
    live pages (17 products + `/corporate`, `/delivery`), found 13.10 and simply not crawled yet —
    wait, or «Запросить индексирование» on the top ones (~10 a day). The 404 / 5xx / robots /
    redirect-error validations have been running since 07.10; every URL in them 301s now.
  - Two product names carry a typed «| BÁLIER» suffix (`shkirianyi-hamanets`,
    `cholovicha-shkiriana-sumka-cherez-pleche`) — it leaks into the h1, breadcrumb and Product
    JSON-LD name; strip it in the panel.
  - Neon is on the **Free plan** (moved there 2026-10-21): 100 CU-hours a month per project,
    scale-to-zero after 5 min that cannot be switched off, 6 h of history, 1 GB storage (DB is
    64 MB). 100 CU-hours is ~400 h of a 0.25 CU compute; the `*/15` cron alone keeps it awake
    ~22 min an hour ≈ 68 CU-hours, before any visitor. **Running out suspends the database until
    the next month.** Done 2026-10-21: the cron sweep is hourly (`0 * * * *`, deployed
    `190d97ee`, uncommitted) and the owner pinned max compute to 0.25 CU in the Neon console the
    same day. Left: look at the Usage graph around 2026-10-28 — over 25 CU-hours in the first
    7 days means the month won't fit, and the next lever is an edge cache for catalog pages.
  - Russian-language version: the site is Ukrainian only. Decide with the Search Console query
    report in ~4 weeks, not by default — a `/ru` tree is 3–5 days plus translation.
- **Loose ends carried:** the neon CLI's link files (`neon.ts`, `@neon/config` + `@neon/env` in
  the root `package.json`, `.claude/`, `skills-lock.json`) are **uncommitted on purpose** —
  developer tooling, decide at teardown. `settings.np_seat_dimensions` is a dead row since the
  parcel-size change; nothing reads it. `docs/CONVENTIONS.md`'s design section still describes
  the cream/rust palette the shadcn pass replaced (docs change on request).
- **Rules that bind any future panel screen** (written up in `docs/CONVENTIONS.md` → «Admin
  panel»):
  - A schema is only verified against the body the form actually sends — `curl -F` can supply a
    field no control renders; validation tests build their body from a real `FormData`.
  - Progressive enhancement, not no-script: the form must work as a plain form; script improves it.
- **Still worth carrying:**
  - `MAX_ITERATIONS = 100_000` in `packages/lib/src/auth/password.ts` is a hard runtime ceiling —
    the deployed Workers runtime refuses PBKDF2 above it, and no local gate can catch a breach.
  - Sessions are revocable per account (`sessions_valid_from`); rotating `ADMIN_SESSION_SECRET`
    ends everyone's at once.
  - The admin login budget is the one counter that must stay atomic — `auth_attempts`, not KV.
    Every other budget is KV on purpose, where approximate is the right trade.
  - `pnpm admin:user` cannot reach the archive — archiving and purging are panel actions on
    purpose.
  - No customer-facing notification on an admin status change — deliberately not built.
  - **After a `wrangler login` switch, each package's `node_modules/.cache/wrangler/wrangler-account.json`
    still pins the previous account** (2026-09-10: all three held a `qio.finance` account id and
    every API call 401'd). Delete the three files; the root one is rewritten by the next command.
  - Prerendered pages and static assets never reach the Worker — anything that must apply to them
    (headers, caching) belongs in `public/_headers` as well as the middleware.
  - The dev environment (`*.mlosko.dev`, dev Neon, `balier-dev` / `balier-admin-dev`) is
    unreachable since 2026-09-07. Its last recorded state is this file at `17e0a5e`.

## ✅ Phase tracker (high-level; detail in docs/plans/roadmap.md)

- [x] Phase 0 — Preparation (Neon, R2, KV, the production Monobank merchant, the Nova Poshta
      key and the Telegram bot all on the owner's own accounts)
- [x] Phase 1 — Foundation (schema, migrations, seed, design components, deploy verified)
- [x] Phase 2 — Catalog / storefront (every page built and filled; `/palette`,
      `/personalization` and `/corporate` added from the owner's PDFs 2026-09-18)
- [x] Phase 3 — Cart and payment (code-complete: cart, `/checkout`, both payment methods, Turnstile
      (built, then commented out on request — the code stays), the webhook, both Telegram
      notifications, rate limiting, the confirmation email, `balier-cron` deployed, and as of
      2026-08-06 the Email Sending DNS records exist and deliver. Driven live end to end on
      2026-09-18/20, card and cash on delivery both; an e-mail promo code joined the path)
- [x] Phase 4 — Admin panel (its own login form — PBKDF2 + signed session cookie, fail-closed,
      verified on the deployed Worker; orders list, detail, transitions, TTN and manual order
      creation; `/settings` for the COD limit; and the catalog — `/products`, its editor,
      `/categories` and image upload. Deployed; since the split the whole phase lives on
      `admin.balier.com.ua`, plus «Клієнти» 2026-09-20)
- [~] **Nova Poshta operations** — outside the phase numbering, its own file
      `docs/plans/novaposhta.md`: waybills, the register of shipments, and carrier-driven order
      statuses. NP-1..NP-5 deployed and driven live. On the owner's own account since
      2026-09-18; the per-variant weight became `products.parcel_size` («до 2 кг» / «до 10 кг»)
      on 2026-09-20, since a missing weight was blocking almost every waybill
- [x] Phase 5 — Launch (`docs/plans/launch.md`). Live on `balier.com.ua` since 2026-09-18:
      production Monobank merchant, Nova Poshta key, Telegram bot, indexing on, one real paid
      order. `/checkout` and the COD waybill path driven live; Turnstile stays off by decision
- [~] Phase 6 — Improvements (taken as asked rather than as a phase: the e-mail promo, the
      customers screen, the SEO/AI basics, the security pass. Open: product feed, Meta pixel, UTM
      attribution on orders, campaign codes, a Russian version)

---

## 🗒️ SESSION LOG (newest first; 3–6 lines each)

> Empty by design. Everything through the end of Phase 4 was moved to **`docs/history.md`** on
> 2026-08-05, not rewritten — this file is read in full at every session start and had reached
> 852 lines. New session entries go here; move a phase's entries across once the phase is done.

**2026-10-15 (Search Console).** The owner pasted the «Страница просканирована, но пока не
проиндексирована» drilldown (3 URLs, validation failed 13.10). Nothing to fix: the product page is
«Submitted and indexed» per the URL Inspection API since the 13.10 crawl (the report lags a day);
`faq.html` / `dostavka.html` are old-site URLs last crawled in May that 301 to `/delivery`. Looked
at the rest of the Pages report too: «Ошибка переадресации» on `feedback.html` (07.10) passes a
live test now; the 19 «Обнаружена, не проиндексирована» are live products found 13.10 and not yet
crawled. No code changed. Two product names carry a typed «| BÁLIER» suffix — owner's fix in the
panel. The GSC MCP (`~/mcp/mcp-gsc`) works now: URL inspection ran through it.
2026-10-16 (cont.): «потяни ошибки индексации рекомендации от гугл» — the full pull. All 58
sitemap URLs through the Inspection API: 44 indexed, 5 «Discovered», 9 «unknown to Google»
(`/delivery` and `/returns` among them), no technical fault on any. Every legacy URL in the eight
reason groups 301s to the right place. Merchant listings: 0 errors, all four warnings confirmed
fixed. Product snippets: `review` / `aggregateRating` missing on 17 — only real reviews fix that,
the belt already carries one. Manual actions and security: none. Google's one recommendation: link
Search Console to Merchant Center «Balier (5871202153)» — a click for the owner, not done.
2026-10-21 (cont.): «по поиску balier в гугл мне не выдало сайт». Reproduced from the owner's
screenshot: their Chrome profile is English, and with `hl=en&gl=ua` the bare query «balier» has no
balier.com.ua on pages 1–3 (Instagram, Rozetka, Facebook, ZRK, Shafa, Work.ua, YouTube instead);
the English AI Overview cites only those. With `hl=uk` or `hl=ru`, with `lr=lang_uk`, or for
«balier bags» the homepage is first. Search Console: «balier» at position 2.3, 57 impressions /
44 clicks in 28 days, 47 of them mobile at 1.8 — the uk/ru audience finds it. Cause: the site is
`lang="uk"` only, no English page or hreflang, so for an English-interface user Google's language
preference drops a month-old domain off the bare brand query. Not a code bug. Owner's call: an
English version (same decision as the deferred Russian one), or accept. Side finding: the Business
Profile website link is `http://balier.com.ua/` — 50 impressions, 0 clicks on that URL in GSC;
change it to https in Business Profile.
«перешел на фри тир в неоне» → «давай крон раз в час и задеплой»: Neon Free is 100 CU-hours a
month, scale-to-zero at 5 min, 6 h history, 1 GB storage; running out suspends the DB until the
next month. The `*/15` cron alone would burn ~68 CU-hours. Trigger and handler case moved to
`0 * * * *` (`workers/cron/wrangler.jsonc`, `workers/cron/index.ts`), gate green, `balier-cron`
deployed `190d97ee` with schedules `0 * * * *` and `0 4 * * *`. Uncommitted. Catalog and product
pages still hit the DB per visit (edge cache covers only the NP lookups) — a later, separate ask.
2026-10-23: GTM container `GTM-NZK3XGBG` pasted by the owner («add to web site») → `~/lib/googleTagManager.ts`
+ both halves of Google's snippet in `BaseLayout.astro`, production only like the other tags; gate
green, site deployed `98f2e7cc`, verified on `/`, `/about` (prerendered) and a product page.
`GOOGLE_ADS_ID` is still empty, so GTM is the only Google tag — no double counting. Uncommitted.
Edge cache for the catalog: «давай сделаем edge-кеш», owner chose invalidation by a catalog version
in KV (option A); design presented, awaiting approval before the spec in `~/.claude/plans/`.
«проверь usage неон нужен ли кеш?» Production Neon is **`curly-smoke-75808809` («Acelerator»,
org «Oleksii» `org-silent-tooth-80755892`, owner oleksii.kilevoi@drizzle.team)** — the project the
Neon MCP is connected to (launch.md was right; the «balier» project in Mykhailo's «mlosko» org is
the old dev DB, still woken every 15 min by something outside this repo, not our quota). Free
period started at the downgrade, 2026-10-21 13:08 UTC. 43.5 h later: 6.53 CU-hours, compute active
25.9 h of 43.5 (59 %), production endpoint `ep-holy-sunset-b1lcnrei` capped 0.25↔0.25 CU. Rate
≈ 3.6 CU-hours/day ≈ 110 a month → fits October (period is short) but **overruns 100 in a full
November**, DB suspended for its last days. Cron is ~0.6 of the 3.6; the rest is traffic waking
the compute. Verdict: the edge cache is needed on Free, or Build ($10, 250 CU-hours) instead.
GA4 `G-P9NKSG62B4` pasted («Добавить тег») → `~/lib/googleAnalytics.ts`; the Ads-only gtag block in
`BaseLayout.astro` became one `gtag.js` load for every ID in `GTAG_IDS` (GA4 + Ads when set), so
the Ads conversion on `/checkout/success` keeps working through the same `window.gtag`. Gate green,
site deployed `855064c1`, verified live on three pages. Uncommitted. GTM and GA4 are both on the
page now: if a GA4 tag is ever added inside the GTM container, views count twice — one place only.
2026-10-26 «проверь neon usage»: 20.45 CU-hours after 114.9 h of the period, compute active
81.3 h (71 %); the last three days alone ran at 4.7 CU-hours/day with the compute awake 78 % of the
time. Projection: October ends near 47, a full November ≈ 130–145 → the 100 limit falls around
20–23 November. Trend is up, not down. Cache (or Build plan) still undecided by the owner.
2026-10-28 «проверь ошибки по search.google»: sitemap 67 URLs (new category
`obkladynky-dlia-dokumentiv` + 8 products), Inspection API: 51 indexed, 3 «Discovered», 13
«unknown» — all 16 are 200, no noindex, self-canonical, just uncrawled; 13 of them unchanged since
16.10. Report: 49 indexed / 43 not, redirect-error group confirmed fixed, Merchant Center linked
16.10. One real finding: product slug renamed from `shkirianyi-chokhol-na-viiskovyi-kvytok` to
`shkirianyi-chokhol-viiskovyi-kvytok` after Google saw the old one on the category page → 404 in
the report; no slug-history mechanism exists, a one-line entry in `legacyRedirects.ts` fixes it
(offered, not applied). `/user/avtorizatsiya.html` 404 is the old site's login page, honest 404.
Product snippets warnings (`review`/`aggregateRating`) now on 12, Merchant listings clean.
2026-10-30: «давай добавь редирект и задеплой» → `RENAMED` map in `legacyRedirects.ts` (our own
renamed product slugs, checked before the old-site rules; one line per rename, test first), site
deployed `3c6a7331`, old slug 301s live. Uncommitted. Neon the same day: 40.6 CU-hours after
210.8 h of the period, compute active 77 %; the last four days ran at 5.0 CU-hours/day (84 %
awake). October ends ≈ 49; a full November at this rate ≈ 150 → the 100 limit falls ~20 November.
«проверь ошибки и исправления» + «запроси индексацию» (same day): report unchanged (49 / 43), the
old slug still filed as 404 until recrawl. Requested indexing through the URL inspector for 11 of
the 16 uncrawled pages — `shkirianyi-hamanets`, `cholovicha-shkiriana-nahrudna-sumka`,
`portfel-dlia-noutbuka`, `dorozhnia-sumka`, `sumka-lunet`, `sumka-dlia-telefonu`,
`portmone-z-khliastykom`, `hamanets-iz-vikonechkom-dlia-dokumentiv`, `fartukhoksford`,
`shkirianyi-fartukh`, `shkiriani-kaptsi-dlia-budynku` — then «Квота превышена». Left for the next
day: `personalizatsiia`, `chokhol-dlia-zakordonnoho-pasportu`, `shkirianyi-braslet`,
`sumka-dlia-dokumentiv`, `/returns`. Oddity: the inspector says none of them is referenced by a
sitemap, though all are in `/sitemap.xml` (Google read 65 of 67 URLs on 27.10).
«Давай настроим рекламу…» → plan given in chat (measure first: GA4 e-commerce events, Meta
Pixel + CAPI, margin for a CPA ceiling, Neon cache; then Shopping → brand/category Search →
Instagram retargeting; admin order attribution as the source of truth). «давай с событий GA4» →
built: `packages/lib/src/analytics/ga4.ts` (tested, 7 cases; `item_id` = SKU like the Merchant
feed's `g:id`), `apps/site/src/lib/ga4.ts` wrapper, `view_item` + `add_to_cart` on the product
page (button and «до комплекту»), `add_to_cart` + `begin_checkout` on `/checkout`, `purchase` on
`/checkout/success` under the existing paid/COD gate and once-per-order guard; `CompanionOffer`
gained `sku`. Gate green; the auto-mode classifier refused `pnpm deploy:site`, the owner ran it
(`d0dff5c4`). Verified live in Chrome through `window.dataLayer`: `view_item`, `add_to_cart` and
`begin_checkout` carry SKU, name, variant, category and hryvnia prices; `purchase` waits for the
first real order (GA4 Realtime). Next for ads: Meta Pixel + CAPI, then link GA4 ↔ Google Ads and
import `purchase` as the conversion. Uncommitted.

**2026-10-02 (SEO, Jev).** «How I can use Jev for SEO optimisations». Jev SEO is TypeSafe AI's
open-source auditor; ran its Rust CLI (v0.1.2, checksum-verified, scratchpad only, no API key so
rules only — no Jev semantic scoring yet). Crawl 100/100; its "no compression" and "invalid
sitemap" were false positives. Fixed the markup findings (18 → 1 on the sampled pages). Left for
the owner: product meta titles over 60 chars (key holders, slippers, belt) and the new page copy
to review. Next: with a `TYPESAFE_API_KEY`, rerun with Jev scoring; resubmit the sitemap.
Reputation check: Safe Browsing clean. Root `_dmarc` moved `p=none` → `p=quarantine` (only the
Hosting Ukraine mailbox sends as @balier.com.ua; it passes via SPF) — `p=reject` after a few
quiet weeks. Domain renewed 2026-10-06 at ukraine.com.ua — now expires 2027-10-16.
2026-10-06: Search Console merchant-listing warnings → `4971afd`, deployed (`56e039da`): Product
JSON-LD drops free-text `category`, gains `hasMerchantReturnPolicy` (14 days, by post). 2026-10-08 `e528273` (`0b53a50a`): + `returnFees: ReturnFeesCustomerResponsibility`. Merchant Center: one source «balier.com.ua feed (UK)», Ukrainian, 78 items; the Russian-language source deleted. `e821c58` (`b7661c59`): `shippingDetails` from `PARCEL_TARIFFS` (NP 90/135 ₴, tariff 2026-04-13) + `DELIVERY_DAYS` (1–2 handling, 1–3 transit) in `novaposhta/parcel.ts`. Owner to check box size on riukzak, shoper, sumka-na-pleche, sumka-cherez-pleche-na-blyskavtsi (set «до 2 кг»).
2026-10-08 (cont.): One Dollar Stats funnel events `bfb8b73` (Add to cart / Order placed / Purchase — card & parts only once paid / Promo signup; `apps/site/src/lib/analytics.ts`), reviewed by two agents. «Не показувати в Google» product flag `50dbf82` — migration 0029 `hidden_from_search` applied to production, site `8de12649` + admin `62165e38` deployed; owner to tick it on the greeting card. Not done on purpose (owner's call): shipping rate without NP's 0.5% declared-value commission, `g:shipping` in the feed. Owner questions: made-to-order handling time, returns on personalised items. Search Console MCP: `~/mcp/mcp-gsc` installed and audited, waiting on the owner's service-account key.
`shippingDetails` left out on purpose — Nova Poshta tariff has no fixed rate; set it in Search
Console / Merchant Center if wanted. UTM cheat sheet: claude.ai/artifact/QGFsW5ABUCSxAjYkb8nu24
(Instagram's own tag is `ig`).

**2026-09-29 (banner).** «надо в админку добавить баннер который будет на главной» + the
owner's PDF. One image-and-link banner, phone variant optional, above the featured grid — which
undoes part of the 2026-09-16 «сразу должны быть товары» call, at the owner's request. Wrangler
had lost its login (the site build needs remote bindings); `wrangler login` fixed it. Owner
reviewed on local dev, then both Workers deployed. Phone text on the desktop picture is small —
a portrait version for the phone slot is the owner's to supply.

**2026-09-25 (студія, не код).** «хочу использовать этот проект как темплейт». Нічого в репо не змінено. Інвентаризація того, що прибите до balier (~40 файлів з брендом, 3× wrangler, 1 246 рядків inline-копі статики, варіанти лише по кольору) — у плані `~/.claude/plans/toasty-forging-pascal.md`. Результат сесії лежить поза репо, в `~/shop-studio/`: 36 лідів (34 без сайту) з Instagram по нішах кераміка/свічки/шкіра/прикраси/іграшки/епоксидка, директ-скрипти, оферта з цінами ринку, процес follow-up, one-pager як Artifact. Наступне для цього репо: шаблонізація (brand.ts, wrangler через змінні, `scripts/fork.ts`), потім розмірні варіанти.

**2026-09-22 (security).** «проверь сайт на секюрити». Two passes — a subagent over the
auth / upload / injection / webhook code, live probing from outside. The auth layer held; the
residue was real: a critical Astro advisory, a login budget that lost count under concurrency, no
security headers at all (the panel could be framed), an OTP budget that renewed with every code,
promo mail aimed at any address. Five commits, deployed by the owner and verified from outside;
`pnpm audit --prod` clean; migration 0021. HSTS on at Cloudflare, 12 months with subdomains.
Left alone on purpose: the per-webhook Monobank pubkey fetch.

**2026-09-21 (old URLs).** The first Search Console coverage export was mostly the 2019–2025 site
that used to live on this domain: 21 × 404 on its `/shop/…/*.html`, robots blocks it carried, four
URLs indexed blind. `legacyRedirect` maps its content pages to their successors and its shop paths
to the nearest category; `/api/*` stopped being disallowed and started saying `noindex` in a
header instead, the panel too. Viber added to the footer, contacts and `llms.txt`.

**2026-09-20 (promo, customers).** The e-mail promo end to end: popup after a minute on the site
counted across pages, address in, a unique code out by mail, redeemed once inside the order
transaction and handed back if the order is cancelled. The same day `parcel_size` replaced the
per-variant weight, which had been blocking 26 of 28 waybills (migration 0020). Panel got
«Клієнти» — customers folded out of orders, plus the promo mailing list — and a guard that a
second variant must name its colour, after a real order arrived on an unlabelled black swatch.
Product page reordered so price and colour share one phone screen.

**2026-09-18 (launch day).** Indexing switched on and the SEO basics with it: the prerendered
pages' canonical had been carrying `.html`, `robots.txt` and `/sitemap.xml` did not exist, there
was no structured data. Added `/llms.txt` and content signals for AI crawlers. Three pages built
from the owner's PDFs (`/palette`, `/personalization`, `/corporate`), category nav on the catalog,
the cream background `#f6f4e8`, One Dollar Stats, the Telegram manager handle. The owner brought
the production Monobank token, a new Nova Poshta key and the bot; the first real order followed.

**2026-09-16 (next steps).** «какие дальше шаги», in plan mode. Read-only checks against the
account and the tree: nothing from the 2026-09-10 hand-off had been done (no zone, bucket, KV,
NS; `.dev.vars` still empty except `DATABASE_URL`; seven pages still placeholder). Wrote the
ordered plan (blocks A–F, owner vs agent), approved. Executed the two agent-side items that need
nobody: `ADMIN_SESSION_SECRET` generated into `apps/admin/.dev.vars`; confirmed by reading both
`astro.config.mjs` and `deploy.mjs` that a missing `SENTRY_AUTH_TOKEN` only skips sourcemaps.
Recorded the per-package wrangler account-cache trap. Later the same day: L1 pages from the PDF,
the catalog loader, the three deploys, secrets, then a design pass (centred static pages, shadcn
neutral theme, Cormorant + Source Sans) and the Instagram brand read (`docs/plans/brand.md`).
Earlier: the owner created the bucket and the
KV by hand, and the zone check showed **`balier.com.ua`** — the real domain; every production
hostname renamed (7 files + typegen), launch.md rewritten to it. Nothing deployed; nothing pushed.

**2026-09-10 (launch, L3 → L2).** «guide me until launch». `wrangler whoami` showed the login
made minutes earlier is the developer's own account — one membership, no invites — and
`dig NS balier.ua` came back NXDOMAIN from the `.ua` registry: the domain has no delegation at
all. The client first chose a client-owned Cloudflare account, then reversed it: the owner runs the
site, production on this account. R2/KV creation was blocked by the permission classifier. Committed L3
as `2adbb7e` and the docs as `17e0a5e` (gate green, nothing pushed); the neon CLI's link files
stay untracked. `pnpm admin:user list` against production: no admins. Nothing deploys until the zone exists. CURRENT STATE cut from 177
lines to the handover — the dev environment's state lives in this file at `17e0a5e`.

**2026-09-16 (L1 from the PDF).** «'про нас_merged.pdf' добавь на сайт». The PDF turned out to be
all seven pages, not one. Transcribed each into its `StaticPageLayout` slot as h2/h3/p/ul,
dropped two notes-to-self and the care page's eight product photos, fixed two typos, filled the
legal pages' email/phone from the contacts page and left the seller's identity as visible
brackets. Photos via `pdfimages` → `sips`. `ContentPlaceholder` deleted. Gate + build green.

**2026-09-07 (launch plan).** «analyse repository and write down steps needed for launch».
Read STATE, roadmap, OVERVIEW, the NP and Sentry plans, all three `wrangler.jsonc`, the four
`.dev.vars.example`, the seed, settings queries and every place a dev hostname is hardcoded;
wrote `docs/plans/launch.md` in the plan-file mould (L0–L6 + teardown). Two findings that were
not in any doc: Sentry BALIER-5 shows the deployed dev cron still sweeping `stock_reservations`
(dropped by `0016`) — `pnpm cron:deploy` never ran after `ec0797e`; and `worker-configuration.d.ts`
types `ORDER_EMAIL_FROM` as a string *literal*, so changing that var needs `pnpm cf-typegen` or
`pnpm check` fails. Nothing in the app changed; STATE.md's «uncommitted» lines corrected to
`ec0797e`. No gate run — fresh clone, no `node_modules`.

**2026-08-10 (без скидок).** «Убрать "Стара ціна" полностью, система скидок не нужна сейчас».
The one thing worth asking was depth — code-only or the column too — and the client took the
column: migration `0018` is a bare `ALTER TABLE products DROP COLUMN compare_at_price`, applied to
dev, so the old prices are not recoverable. Removed with it: the panel field and its hint, the
`compareAtPrice` line in `productSaveSchema`, its `CATALOG_FIELDS` entry and its
`ADMIN_CATALOG_ERRORS` string, both selects in `queries/products.ts` and the two interfaces they
feed, `ProductFields` + the `updateProduct` set, `Price.astro`'s `compareAt` prop and struck-through
span (the component is one price now, so `ProductCard` passes one), the product page's
`showCompareAt` (its `<p>` lost the flex it only needed for two children), and the seed's
`hryvnias(2900)`. Kept on purpose: `optionalPriceSchema` and `optionalWholeHryvniaSchema` — the
NULL-is-«not set» rule still has `price_override` to enforce it, and the doc comments were
rewritten to say so rather than deleted. The two compare-at tests went; 325 pass. `pnpm check` +
`pnpm build` green, nothing committed, nothing deployed.

**2026-08-10 (наличие вместо остатка).** Asked to drop the stock figure from the shop and put an
in-stock toggle in its place; the depth was a decision, and the client took the full one — a real
`in_stock` boolean, reservations and arithmetic deleted, overselling accepted without a safety net
(both recorded above). Two migrations because drizzle-kit's rename prompt needs a TTY this shell
does not have: generate with both columns present (`0016`, hand-edited to carry the backfill, the
table drop and the settings-key rename), then generate the drop alone (`0017`). Driven live rather
than assumed: `/api/cart` keeps a quantity of 40 and drops an unavailable line with a notice,
`/api/checkout` refuses an out-of-stock line 409 `cart_changed`, and a **COD order for 7 units was
placed and left `in_stock = true`** (`B260810-B4FNH`) — the proof nothing decrements. The panel was
driven through its own rendered form, per the «curl composes a body no control sends» rule: the
variant row posts `inStock=on`, unticking posts the key not at all, the save redrew the box
unticked with «0 / 3» and the new warning, and re-ticking restored it with price/weight/position
untouched. QA admin `qa-stock@balier.test` created and disabled after. 329 tests; gate green;
nothing deployed, nothing committed. **The cron needs `pnpm cron:deploy` this time** — its sweep is
new code, and its old one queries a table that no longer exists.

**2026-08-09 (Sentry, planned → built → deployed in one day).** Session opened on «что нам нужно,
чтобы начать» over `docs/plans/sentry.md`. Decisions along the way, all recorded in the plan: the
org is the existing `drizzle-team` org we were invited into and **stays ours after release**; one
project `balier` instead of three (worker told apart by tag; DSN-key rate limit guards the shared
quota). Phase 1 verified end-to-end with a temporary throwing route (event captured, 500 still
surfaced, ingest answered 200); Phase 2's 15 captures pass all 334 tests unmocked (no client in
vitest → captures are no-ops); Phase 3 verified as far as tokenless: fake-token build survives a
401 upload, cron `--dry-run` emits bundle+map+release. Client created the token, set 3 build vars
on both Workers, pushed (auto-deploy) and ran `cron:deploy` — first run skipped upload because
`deploy.mjs` read a root `.env` this repo doesn't have (its files are `.dev.vars`; fixed, quotes
stripped), second run uploaded bundle for release `8d103f6`. The site/admin uploads took two
more rounds: the vars had gone into the runtime Variables panel (build-invisible; moved to the
Build section, runtime copies deleted — secrets audited intact after), and the fixed build never
ran because the docs-only tail commit missed the Builds path filter — a Retry build closed it:
8 artifact bundles confirmed over the API. Traps for next time: root `.dev.vars` feeds Node
tooling and is quoted; `wrangler deployments list` prints oldest-first.

**2026-08-08 (OTP refresh bugs → PRG).** Two client-found bugs, one root: the code step rendered
straight in the `otp_send` POST response, so F5 re-posted it — countdown reset every time
(`data-sent` re-stamped sessionStorage), and past the 60 s window a real second code went out,
each refresh spending IP budget besides. `/login/telegram` now answers every POST with a 303 to
itself: step carried by a scoped 5-min `admin_otp_email` cookie (set unconditionally — the
anti-enumeration rule extended to the cookie), messages via `?message=` in `/login`'s mould
(`too_many_attempts` re-peeks the budget on GET, so the minutes count down and the message dies
with the window), countdown stamped on the *submit* of either send form. New `otp_change` intent
(«Змінити пошту») clears the cookie, the escape a typo'd address now needs. Gate green, 30 checks
with real form bodies (server-driven POSTs need `Origin` or Astro's CSRF 403s). Uncommitted.

**2026-08-08 (Telegram OTP sign-in).** Built the second login door on the existing bot: deep-link
handshake (`/settings` section → `t.me/…?start=` → new `/telegram/webhook` route, `secret_token`
derived from the bot token so nothing new to provision), `/login/telegram` (email → code → same
cookie), migration `0015`, `PUBLIC_TELEGRAM_BOT` var, `pnpm tg:webhook` script. Codes hashed under
the session secret, attempts counted in SQL, neutral answers on step one. Driven against dev with
real form bodies — 27 checks, incl. the golden path via a planted code; disposable account
removed after. Webhook deliberately not registered yet: the route deploys with the push.
Post-verification same day: webhook registered (`pnpm tg:webhook set`, after the client's push),
client linked and signed in live; then the resend button got a client-side 60 s countdown —
drawn **unconditionally** after any send (sessionStorage-persisted across the reload a wrong code
causes), because a timer only real sends produced would leak what «надіслано» hides. The server
throttle stays the real fence; `admin-btn` also grew its first `:disabled` state (half-faded,
`pointer-events: none` — silences every variant's hover at once) so the ticking button reads as
inactive. **The countdown + disabled state are uncommitted.**

**2026-08-07 (post-ship review of novaposhta.md + fixes).** Asked to re-check the whole NP build
after it went live, since NP has no test API. Read every module end to end. One real bug:
`volumetricVolume` carried the /4000 volumetric-weight formula into a field the API documents in
м³ — accepted silently by `save`, so every live drive passed; fixed to `/1_000_000` (test now
asserts `0.006` for 30×20×10). Also: seat weights sum exactly to `Weight`; middle name reaches the
counterparty; three waybill refusal keys got the red tone; stale comments in `status.ts`/`ports.ts`
corrected; plan updated (code-2 alert removal `435e6cf`, the volumetric finding, third unverified
edge). Verified the cron deploy timing (15:58:44 UTC, 2 s after `a5a192c` — `arrived` mapping is
live). 315 tests; gate green; uncommitted. Follow-up owed: create-inspect-delete a waybill and
compare the cabinet's volume/tariff.

**2026-08-07 (the `arrived` status: «Доставлено» ≠ «Отримано»).** Asked to make the panel
distinguish a parcel at the branch from a parcel handed over. Migration `0014` adds enum value
`arrived` (BEFORE `delivered`); `tracking.ts` splits codes 7/8 — and 14, «на огляді» — into an
`ARRIVED` set; `status.ts` grows the link in `CARRIER_CHAIN`, `STOCK_COMMITTED`, `revertTarget`
(`arrived → shipped`, `delivered → arrived`) and keeps COD `moneyCollected` at `delivered` only;
`listWaybillOrdersToTrack` tracks `arrived` too; labels — `arrived`: «Доставлено», `delivered`:
«Отримано»; badge tone `attention`; the order page counts `arrived` as carrier-driven. Tests
updated with it (313). Verified on the dev server by flipping `B260804-CHDCK` to `arrived` and
back: badge, hint, «Скасувати» (not refund) for COD-at-branch, `?status=arrived` filter. Gate
green; uncommitted; deploy will need `pnpm cron:deploy` this time (lib's tracking table is
bundled into the cron).

**2026-08-07 (NP-5: the register of shipments, driven live).** Opened on «нам что-то осталось по
novaposhta.md?» — NP-4 turned out already client-verified live (cabinet deletion detached by the
tick), everything deployed, so NP-5 was the whole remainder. Built it: migration `0013`
(`np_scan_sheets` — ref/number/created_at; the order link stays `orders.np_scan_sheet_ref`),
`registerEligible` (strictly `packed` + panel waybill + unregistered, property-tested),
`attachRegister` re-checking rows *and their `np_ttn_ref`* under `FOR UPDATE` (a recreated waybill
fails the batch and the fresh carrier register is compensated away), checkbox selection on
`/orders` posting one plain form to `/registers`, the `/registers` list, `/registers/[ref]`
(remove-one, delete-whole, `enhanceAdminForms`), and the key-server-side print proxy. Driven whole
against the real API: two waybills → register 105-79180799 → 204 KB PDF → every refusal → remove →
delete → waybills deleted, account and dev DB left clean (QA admin `qa-np5@` disabled after).
Unverified on purpose: `insertDocuments` partial acceptance and a cabinet-deleted register (no
tracking equivalent to ask) — both in the plan's NP-5 notes. 312 tests; gate green; uncommitted.

**2026-08-07 (review + four fixes + NP-4 built).** Asked to review the uncommitted NP work before
continuing. Found: `carrierStatusIntent` coding carrier code 2 as «quiet» *with a test asserting
it* — the exact opposite of the plan's detach+alert decision, and the table NP-4 was about to be
built on; the COD blocker telling operators to wait for a business account NP-3's live driving
proved unnecessary (now the same «заповніть відправника» as card orders, plan decision reversed
with consent); two stale comments (`ports.ts` naming the dropped `delivery_city_ref`, the dead
`ttn`-intent reference). Then NP-4: `CarrierStatusIntent.detach` (code 2 → detach + `deleted`
alert, never combined with a move — property-tested), `decideCarrierStatus`/`applyCarrierStatus`
(pure decision + `FOR UPDATE` apply, `waybill_changed` skip, status columns written only on a
changed code — the tuple-churn lesson, alerts only on a fresh code — 96-pages-a-day guard),
`status.ts` exit-only for the panel with `carrierCanAdvance` owning the forward chain
(`revertCrossesPayment` and its warning deleted with the button), cron */15 tracking tick,
`CarrierAlerts` on the Telegram notifier, forward buttons off the order page with an
«автоматично» hint in their place. The stuck-order alert was built (`STUCK_ORDER_DAYS = 2`,
04:00 daily) and **removed the same evening at the client's request** — reversal recorded in the
plan's «Decisions», the no-forward-buttons risk stands unmitigated on purpose. Asked what code 11
does in the panel, found `npMoneyTransferAt` was stamped but rendered nowhere — the «Нова Пошта»
card now shows «Грошовий переказ зараховано · дата». 308 tests; gate green; **not driven live,
not deployed, not committed**.

**2026-08-07 (order-page fixes: no-reload, «ТТН створено», manual ТТН removed).** Three asked-for
fixes on `/orders/[n]`. The page joined the `enhanceAdminForms` screens — every POST (status,
waybill create/delete) now swaps in place with the answer as a toast, the copy-link button re-wired
per swap via `onRender`, disclosures keeping their open state by new ids. `packed`'s label is now
«ТТН створено» («Повернути до «ТТН створено»» on the revert; `waybill_created` is just «ТТН
створено.»). Manual waybill-number entry removed whole: template block, `ttn` intent,
`trackingNumberSchema`, `setOrderTrackingNumber`, four message keys — and the «Позначити
упакованим» button with it, per the plan's «no button for `packed`» decision (forward filter drops
`packed`; a paid/confirmed NP order moves forward only via «Створити ТТН» now). Known edge left on
purpose: legacy hand-entered ТТН rows keep rendering their manual-entry note but have no delete
path anymore. 303 tests; `pnpm check && pnpm build` green; not yet driven in a browser (the swap
behaviour is script-only), not committed.

**2026-08-07 (order editing).** Asked to make an order's name, phone, email and delivery address
editable. Built `/orders/[n]/edit` in `/orders/new`'s draft mould (same field names and pick
actions, same picker, same enhancement script), linked from both order-page cards. The rule is
`orderDetailsLock` (`orders/status.ts`, tested): editable through `packed`; any ТТН refuses with
`edit_ttn_exists` — delete, edit, recreate — and `updateOrderDetails` re-checks under `FOR UPDATE`.
Courier legacy orders save contact-only unless a branch is picked (picking converts them, clearing
the street address). Driven live: contact save, email clear/restore, re-route Київ→Харків→back,
both locks, a forged POST refused, courier save keeping its address; QA rows restored after.
303 tests; gate green; uncommitted. Found while driving: curl on this shell mangles Cyrillic form
bodies to `?` — the drive scripts use Node `fetch` (`scratchpad/drive-edit*.mjs`). Follow-up: the
`/settings` one-tap city chips added to the settlement picker on `/orders/new` and the edit page —
same `topSettlements` ranking, each chip a real `pick_city` submit; driven on both pages. And the
other way: `/settings`' branch picker lost its «Знайти» button (typing already asks for the same
render) — replaced by `/orders/new`'s sr-only default button, which also fixes the quirk where a
script-off Enter would «click» the first suggestion row or the «Київ» chip instead of searching;
driven: a no-button search POST still answers with suggestion rows.

**2026-08-07 (NP-3 follow-up 3: four picker bugs, reported from a browser).** The client drove the
new branch picker and found what curl had not: a cleared settlement box refilled itself (two causes
— an empty query still carried the old ref forward, and the render fell back from an empty draft to
the *stored* settlement; both fixed — a draft's word is now final, clearing un-picks); the branch
box did not follow the settlement box (it now empties whenever the settlement is being searched or
absent, and is disabled without a chosen settlement, `/checkout`'s rule); the one-tap city chips
were missing entirely (added — `topSettlements`, same ranking as checkout, each chip a real
`pickSettlement` submit so it works with script off); and «Нічого не знайдено» pushed «Знайти»
downward (the button aligns by its own `pt-5` now, not `self-end` against a column that grows).
All four re-driven through the panel: clear→un-pick with the branch box disabled, typing over the
city resetting the branch, chip tap picking Київ, branch pick saving. 297 tests; gate green;
uncommitted. The admin dev server died once mid-session and was restarted (same `pnpm dev:admin`,
now under this session).

**2026-08-07 (NP-3 follow-up 2: the branch picker, and the cabinet-deletion dead end).** Two more
asked-for fixes. «Звідки відправляєте» became `/checkout`'s own picker instead of two text boxes:
type-ahead settlement suggest (suggestion rows are real submit buttons carrying their ref, so it
all works with script off; search-as-you-type is `requestSubmit` debounced into
`enhanceAdminForms`), then the branch list scoped to the chosen settlement, and clicking a branch
row *is* the save — with the un-pick-on-typing rule and dropdown dismissal mirrored from
`/orders/new`, whose draft mould this reuses (`adminNpPlaceSchema` died with the text boxes).
Driving it caught the un-pick bug (picking left the query in the box, which read as searching and
un-picked). And the dead end the client hit live — a waybill deleted in the NP cabinet refuses
panel deletion forever («No document changed DeletionMark») while the record stands — is closed:
on a delete refusal the page asks *tracking* rather than parsing error text, and codes 2/3
(«видалено»/«не знайдено») let the detach proceed. Reproduced end to end: waybill created via
panel, deleted raw at NP, panel delete then cleanly reverted the order. The *automatic* half —
the nightly sync detaching cabinet-deleted waybills without a click — is recorded in the plan as
NP-4's job (code 2 → detach + alert, table updated). 297 tests; gate green; uncommitted.

**2026-08-07 (NP-3 follow-up: the sender section stopped asking for UUIDs).** Two asked-for UX
fixes on `/settings`. The phone field wears `/checkout`'s mask (fixed `+380`, nine grouped local
digits, `applyPhoneMask` delegated so the reload-free swap keeps it; the schema reads the digits
via `phoneDigitsFromInput`, so script-off and pasted `0…`/`380…` forms still land). And the Ref
fields are gone from the form entirely — they existed nowhere an admin could copy them from. The
section is now three forms: «Підтягнути з акаунта» (new `novaposhta/sender.ts`
`fetchSenderIdentity` — counterparty + contact + phone straight off the API key, names stored in
two new settings keys and rendered instead of UUIDs; the account's phone fills an empty field,
never overwrites a chosen one), a branch picker («Київ» + «1» → resolved against the synced
dictionaries server-side, exact branch-number match outranking street-substring hits, saved with
its `city_ref` and rendered back in words), and the typed defaults (phone/dims/description).
`setNpSenderSettings` became partial `updateNpSenderSettings` — three forms own three subsets.
Driven live through the panel: fetch filled «Приватна особа · Шулежко Михайло Олександрович»,
the picker resolved «Київ, Відділення №1», both not-found refusals render in place, and a waybill
was created and deleted with the settings written this way. 298 tests; gate green; uncommitted.

**2026-08-07 (NP-3: waybills in the panel, driven live).** Opened with the round trip NP-2 owed —
it caught a real client bug on its first run: NP's document methods answer a refused `delete` with
`errors` as an *object keyed by ref*, and the client's `.join` crashed over the actual message
(fixed, both shapes formatted; two test waybills created and deleted, account clean). Built the
panel half: `orders/waybill.ts` (`attachWaybill` — `FOR UPDATE`, refuses `ttn_exists`/
`waybill_invalid_state`, deliberately not `canTransition` since that also offers `packed` as
`shipped`'s revert; `detachWaybill` clearing every `np_*` column), `waybill_create`/
`waybill_delete` intents, the «Нова Пошта» card with in-place refusals (carrier text verbatim),
the `marking` proxy route, `ttn_managed` guarding hand-edits of panel-made numbers. Driving it
found the day's big one: **`np_settlements.delivery_city_ref` was NULL for all 26 791 rows** —
`getSettlements` never returns `DeliveryCity`; the column was designed against data that does not
exist. Migration `0012` drops it and adds `np_warehouses.city_ref` (the feed's `CityRef`), sync
maps it, waybills read the warehouse's city; Kyiv backfilled by hand (7 775 rows), the country
fills on the next full sync. Driven through the dev panel against the real API: create → «Друк
маркування» (real PDF through the proxy) → delete → revert, on a card order (→«Оплачено») and a
COD order (→«Підтверджено»); **NP accepted COD backward delivery on the personal key**, contrary
to the plan's expectation; Latin names refused («FirstName has invalid characters»), surfaced
verbatim in the banner as designed. QA admin `qa-np@balier.test` created and disabled after.
299 tests; gate green; not deployed, not committed.

**2026-08-07 (NP-2: the adapter).** Answered the plan's first question before writing a call:
**API 2.0 has no sandbox** — the only NP test environment (`api-stage.novapost.pl`) belongs to the
new international REST API and refuses UA keys; recorded in the plan, so NP-3 drives
create-then-delete. Built the adapter: `ShippingPort` grew the eight waybill/register methods and
their types (`CreateWaybillInput` warns in its own doc that `cityRef` is the *city* dictionary
ref, not the settlement ref orders store); `waybill.ts` (pure `buildWaybillPayload` — always
`WarehouseWarehouse`, recipient pays carrier; `ensureRecipient` over `Counterparty.save`;
`toUahString` kopiyka-exact because COD pays it out; `kyivToday` because the API refuses past
dates and workerd's clock is UTC), `tracking.ts` (batch-100; status table with the
alert-never-moves property test; codes 41/14/108 added over the plan's table — 14 «на огляді» maps
to `shipped`, not `delivered`), `scanSheet.ts`, `shipping.ts` factory closing over the key.
Deliberately not done: no live waybill was created — that round trip opens NP-3, so a real
document with the client's dev name on it is made in the session that immediately deletes it.
295 tests (+21); gate green; nothing deployed, nothing committed.

**2026-08-07 (NP-1: schema and sender settings).** Built NP-1 whole. Migration `0011`
(`0011_bouncy_sumo.sql`): `weight_grams` on the variant, seven `np_*` columns on `orders` —
`np_status_code` deliberately **text**, the carrier's answer stored verbatim and interpreted only
by NP-4's `applyCarrierStatus`. The editor's variant rows and add-form grew «Вага, г» (blank=NULL,
zero refused — `optionalWholeNumber`); `/settings` grew the admin-only «Нова Пошта — відправник»
section: five refs, an all-or-nothing seat-dimensions triple (`np_seat_dimensions`), cargo
description, every field optional and a refused form redrawn from its own body (pasted UUIDs are
not retyped). Before any of it: checked the dev API key against the live API — it has a sender
counterparty «Приватна особа» (`9e2a9945-…`) and contact «Шулежко Михайло» (`9e2c1516-…`,
`380988974064`), which unblocks NP-2/NP-3 without waiting for the client. Applied `0011` to dev
and read the columns back. 274 tests (+8); gate green; not deployed, not committed.

**2026-08-07 (Nova Poshta operations — planning only).** Asked to plan waybill creation, the
documents handed over at the branch, and status sync replacing manual status management. Read the
existing ground first, which changed the plan twice: courier delivery was **withdrawn** on
2026-08-06, so every waybill is warehouse→warehouse and no street/house/flat has to be parsed out
of `np_address`; and the catalog carries **no weight at all** (removed by the «site never quotes
delivery» decision), which is a real gap because NP requires weight always and dimensions for
parcel lockers. Four decisions taken with the client, one corrected mid-way: «накладні» turned out
to mean the **register of shipments** (ScanSheet), which they described by function rather than
name — one document for the whole batch so the branch scans once. Weight goes on the variant, with
**no silent default** (a wrong 1 kg is an argument at the counter). COD `delivered` is handover
(codes 9/10), not the money-transfer credit (11, recorded separately). And **all forward status
buttons go away**, unconditionally — the risk that an order shipped outside NP can then only be
closed in the database was raised and accepted, so a stuck-order Telegram alert replaces them.
Written to `docs/plans/novaposhta.md`, deliberately **not** into `roadmap.md`. No code changed.

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

- 2026-10-08 — Order B260923-TVUVK (COD, shopper, 6 120 ₴) sat `confirmed` since 09-23: the owner shipped it on a waybill made in the NP cabinet, which the panel cannot record (manual TTN entry removed 2026-08-07). At the owner's request moved straight to `delivered` in the prod DB (`update … where status='confirmed'`). No review e-mail goes out for it — `requestReview` fires only on a carrier-tracked transition; the owner sends the review link from the order page by hand.

- 2026-10-09 — Internal linking (`8662c69`, site `946b90ae`): footer «Магазин» lists every active category on SSR pages (prerendered content pages keep only «Усі товари» — no DB at build); visible breadcrumbs on product pages; «Ще з категорії» block (4 cards, the ones *after* the product in category order, wrapping — `followingInOrder`; excludes `hidden_from_search`). Next on this: category description texts (owner) and links from care/palette/personalization. Measure in ~2–4 weeks: GSC internal links + category impressions, ODS pages/visit (API key at `~/.config/onedollarstats/key`).

- 2026-10-09 — Search Console MCP connected (`claude mcp add gsc -s local`, read-only: service account `gsc-reader@balier-seo.iam.gserviceaccount.com`, «Ограниченный», key `~/.config/gsc/balier-gsc.json`, `GSC_ALLOW_DESTRUCTIVE` unset). First pull, 09-10…10-07: 53 clicks / 155 impressions, almost all brand («balier»). **No sitemap submitted in GSC**; URL inspection: 14 of 53 sitemap URLs indexed, 39 «unknown to Google» incl. all 6 categories and most products. Owner to submit `sitemap.xml` + request indexing of the categories.

- 2026-10-09 — SEO audit of all sitemap URLs as Googlebot: all 200, self-canonical, no noindex, unique titles/descs, 120–600 ms. Fixed (`44c21db`, site `7dac0cfd`): every gallery slide gets alt (manager's or «<title> — фото N»; thumbnails stay `alt=""`), and `sitemap.xml` lists product photos as `<image:image>` (363). Requested indexing in GSC UI for 6 categories + hobo/shoper/riukzak (quota hit on the 10th) — all 9 indexed same day; 23/53 indexed, sitemap still pending. Owner: 6 product titles > 60 chars (keyholders ×2, kaptsi, glasses case, dual, belt).

- 2026-10-10 — Order source (`f3736fa`, migration 0030 `orders.attribution jsonb` applied to prod, site `d95c18f2`, admin `81dabf56`): `BaseLayout` keeps the last non-direct touch for 30 days in localStorage `balier_attribution` (utm_source/medium/campaign, referrer *host* only, landing path; Monobank and own host ignored), checkout sends it, `createOrder` stores it, admin order page shows «Джерело» (`attributionChannel`/`attributionDetails`). Malformed attribution is dropped by the schema (`.catch(undefined)`), never refuses an order. Orders before 10-10 and panel-made ones have none. B261010-79HTT (wallet, card) was most likely Instagram per ODS events.

- 2026-10-12 — GSC status: sitemap fetched 10-10 (55 pages + 366 images, 0 errors); 26/57 indexed, 12 «discovered – not indexed», 19 unknown (mostly new products + new category `aksesuary-dlia-tekhniky`). Old-markup warnings only on pages last crawled before the fixes. Requested indexing via GSC UI for 9: mesendzher, klatch-barsetka, chokhol (stale markup), category aksesuary-dlia-tekhniky, mishok, hamanets-b-lier, sumka-na-pleche, bahet, cherez-pleche-na-blyskavtsi. 10-09: best search day so far (8 clicks / 20 impr.); first non-brand queries («сумка днепр» pos 4).

- 2026-10-12 — Card-sized photos (`320efc4`, site `081cc601`), after PageSpeed flagged ~876 KiB of oversized card images. `/media/w640/<hash>.<ext>` → `@balier/lib/media/card`: a 640px WebP copy made once via a new site IMAGES binding and stored in R2 under `w640/` (so the metered transform runs once per photo, ever; a failed one serves the original with a 1 h cache). Used by ProductCard, gallery thumbnails, companions; the gallery slides and og:image stay full size. All 369 copies pre-generated (0 fallbacks, avg 50 KB); `/products` images 8.7 MB → 1.7 MB. **Amends the 2026-08-03 «we do not resize» decision in roadmap.md — roadmap text not updated (docs change only on request).**

- 2026-10-12 — Category copy layout (`934c327`, site `5f6aa5c0`): the panel's multi-paragraph category description now splits on blank lines — first paragraph under the H1 (and the meta description), the rest below the grid, paragraph breaks kept. Owner doc «BÁLIER: план продвижения в Google» (claude.ai/code/artifact/250aaab0-c7ff-4d55-8494-05089e053b01): admin fixes, Google Ads Performance Max setup, Google Business Profile, reviews, links. **Owner action:** `personalizatsiia` (1 ₴ service) is active and in the Merchant Center feed — tick «Не показувати в Google». Google Ads conversion code is ready in `apps/site/src/lib/googleAds.ts`; needs `AW-…` id + purchase label.

- 2026-10-13 — GSC errors: API inspection of all 58 sitemap URLs — 38 indexed, 5 discovered, 15 unknown, 0 fetch/robots/canonical problems; old rich-result warnings (category/shippingDetails/returnPolicy) gone, only missing review/aggregateRating remain. UI «Страницы» report (lags, last update 10-09): all 29 not-indexed URLs are legacy (`/ru/…`, `/shop/…`, `.html`), each now one 301 to a live page. Started validation for «Ошибка переадресации» (`/feedback.html`, transient on 10-07). GSC MCP tools need a Claude Code restart to load.

- 2026-10-13 — PageSpeed «network dependency tree»: zod (18 KB `schemas.js`) loaded on every page via the header badge → cart store → `validation/cart`, and via `attribution.ts`. Fixed (`6ad9d2f`, site `86a8969b`): `cart/decode.ts` hand-written reader held to `cartItemsSchema` by `decode.test.ts` (18 cases), limits in `cart/limits.ts`, `attributionSchema` moved to `validation/checkout.ts`. No client chunk contains zod now.

- 2026-10-14 — GSC recheck: API — 38/58 indexed, 2 discovered, 18 unknown (incl. `personalizatsiia`, still no «Не показувати в Google» tick), 0 fetch/robots/canonical problems. UI: «Данные о товарах продавца» — all 4 old warnings (hasMerchantReturnPolicy, returnFees, shippingDetails, category) now «Подтверждено» 0; «Описания товара» — only missing review/aggregateRating on 14; Breadcrumbs 23/0, HTTPS 19/0, CWV no data yet (too little traffic). «Страницы» report still lags (10-09).

- 2026-10-14 — Requested indexing in GSC UI (ranked by ODS 30-day views among the 18 unknown URLs): hamanets-konvert, /corporate, sumka-cherez-pleche-z-klapanom, kosmetychka-dlia-podorozhei, shkiriana-kosmetychka, dual — all confirmed. Quota hit on the 7th; still to request: sumka-lunet, portfel-dlia-noutbuka, portmone-z-khliastykom (then kaptsi, shkirianyi-fartukh, shkirianyi-hamanets, /delivery, nahrudna-sumka, dorozhnia-sumka, sumka-dlia-telefonu, /returns). Lesson: a stale button ref silently no-ops after navigation — click by coordinates and verify the «Отправлен запрос» dialog; keep browser batches under ~60 s.
