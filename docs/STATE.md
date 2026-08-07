# STATE — balier.ua

> Single source of truth for "where did we stop". Read aloud at session start.

## 📍 CURRENT STATE (overwrite this block; keep tight)

- **Last done:** **full review of the whole novaposhta.md build + fixes** (2026-08-07, after
  everything shipped). The review found one real bug that survived every live drive:
  `OptionsSeat.volumetricVolume` was sent as the /4000 volumetric-*weight* formula (kg) while the
  API documents the field in **м³** — `InternetDocument.save` accepts the wrong value silently, and
  it inflates the declared volume 250× (a 30×20×10 box declared as 1.5 м³ ≈ a 375 kg parcel if NP
  prices off the field). Fixed to true cubic meters (`/1_000_000`); seat weights now also sum
  exactly to `Weight` (remainder grams go to the first seats); the recipient's middle name now
  reaches `Counterparty.save` (was silently dropped — `WaybillRecipient` grew `middleName`);
  `ttn_exists`/`waybill_invalid_state`/`no_waybill` render red like other refusals; stale comments
  fixed (`status.ts` stuck-order-alert claim, `ports.ts` COD-refusal claim); the plan now records
  the code-2 alert removal (`435e6cf`), the volumetric finding, and a third knowingly-unverified
  edge (deleting a waybill while its order is on a register). 315 tests, gate green.
  **Uncommitted.**
- **Context (client-verified, all deployed):** the whole of `docs/plans/novaposhta.md` — NP-1..NP-5
  plus the `arrived` split (`packed → shipped → arrived → delivered`, migration `0014`) — is
  committed through `a5a192c`, deployed and live; `balier-cron` was redeployed with it (verified:
  deploy 15:58:44 UTC, two seconds after the commit). `NOVAPOSHTA_API_KEY` is on the admin Worker,
  dev-DB admin accounts are `admin@balier.com` + `manager@balier.com` (both on).
- **In progress:** nothing. The gate is green (`pnpm check && pnpm build`, **315 tests**).
  Migrations `0006`–`0014` are all applied to the **dev** database.
- **Next step:** **commit + push** (Workers Builds auto-deploys `balier-admin-dev`; no cron
  redeploy needed — the fix touches the waybill payload, which only the admin Worker builds).
  Then one **create-inspect-delete pass** on the dev key: create a waybill through the panel, open
  the NP cabinet and compare the shown volume/tariff against the same parcel keyed in by hand,
  delete it — the volumetric fix is the one change whose wrongness costs a customer money at the
  counter. Then, in the browser on `admin.balier.mlosko.dev`: the register flow once with real
  parcels (create → print at the branch), and the still-standing browser passes — `/checkout`'s
  delivery step, `/categories`, `/settings`, `/users` — plus the flows curl cannot drive (image
  upload preview, `/orders/new` card order). Then Phase 5.
  **A production deploy needs `pnpm db:migrate` against that database and one
  `pnpm admin:user role <email> admin`**; migrations `0008`/`0009` must land before that deploy —
  the gate reads `sessions_valid_from`/`archived_at` on every request, so code ahead of schema is
  a panel nobody can open. The dev sender settings still point at **Київ, Відділення №1** as a
  placeholder handover branch.
- **Loose end, unresolved (2026-08-06):** `qa-live@balier.test` was once found switched on with
  `sessions_valid_from` stamped, unexplained by any command of that session; set back to disabled
  and written down rather than tidied away.
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
  - **A Nova Poshta API key — no longer a dev blocker** (2026-08-07): the key already in
    `.dev.vars` has a sender counterparty and contact person behind it (checked via
    `Counterparty.getCounterparties` / `getCounterpartyContactPersons`), so waybill creation works
    on it. Test waybills are made in the developer's name — create-then-delete. The client's own
    account remains a Phase 5 item, and the **business account** still blocks only cash on
    delivery, whose code gets written regardless.
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
- [~] **Nova Poshta operations** — outside the phase numbering, its own file
      `docs/plans/novaposhta.md`: waybills, the register of shipments, and carrier-driven order
      statuses. NP-1..NP-4 deployed and client-verified live; NP-5 built and driven live
      2026-08-07, awaiting commit+push. Phase 5's account migration has to carry the sender
      settings and API key across
- [ ] Phase 5 — Launch (incl. migrating off the dev Neon/Cloudflare accounts)
- [ ] Phase 6 — Improvements

---

## 🗒️ SESSION LOG (newest first; 3–6 lines each)

> Empty by design. Everything through the end of Phase 4 was moved to **`docs/history.md`** on
> 2026-08-05, not rewritten — this file is read in full at every session start and had reached
> 852 lines. New session entries go here; move a phase's entries across once the phase is done.

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
