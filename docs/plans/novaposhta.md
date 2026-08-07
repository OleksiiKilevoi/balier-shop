# PLAN — Nova Poshta operations (TTN, registers, status sync)

> Agreed 2026-08-07. Not part of any roadmap phase — this is new scope, planned on its own because
> it touches the order state machine, the catalog schema and both non-storefront Workers.
> `docs/plans/roadmap.md` stays as it is; this file is the one to read for this work.

## Goal

The panel runs the whole shipping side of an order without anyone opening the Nova Poshta cabinet:

1. **A waybill (ТТН / експрес-накладна) is created from the order screen** — recipient, city and
   branch come from the order, the operator only confirms weight and dimensions.
2. **Everything the seller carries to the branch is printed from the panel** — the parcel marking
   for each waybill, and one **register of shipments (реєстр відправлень / ScanSheet)** listing the
   whole batch, so the branch scans one barcode instead of accepting each parcel separately.
3. **Order status follows the carrier, not a person.** Manual status management is removed: the only
   status buttons left in the panel are «Скасувати» and «Повернути кошти».

## Decisions

Taken with the client on 2026-08-07, not guessed. Each one changes scope, so the reasoning is here
rather than in a commit message.

- **Two documents, both needed.** The waybill and the register are different objects in the API
  (`InternetDocument` and `ScanSheet`) and different pieces of paper at the branch. «Створення
  накладних» in the original request means the register — the batch document — and it is what makes
  handing over ten parcels one operation instead of ten.

- **Weight lives on the variant** (`product_variants.weight_grams`, nullable); an order's weight is
  the sum over its items. **Parcel dimensions do not come from the catalog** — they cannot be
  derived from variant weights, and Nova Poshta requires them for parcel-locker delivery. They are a
  shop-wide default in `settings`, editable in the waybill form.
  The column is **nullable with no silent fallback**: an order containing a variant with no weight
  refuses to produce a waybill and says which item is missing one. A default 1 kg would be a quietly
  wrong waybill and an argument with the carrier at the counter.

- **Status is fully carrier-driven, and the panel keeps no forward buttons at all** — not even when
  an order has no waybill. Raised as a risk (an order that ships outside Nova Poshta can then only
  be closed by editing the database) and the client accepted it: self-pickup and hand-delivery are
  not going to happen. The mitigation that replaces the buttons is the **stuck-order alert** below.

- **`delivered` for cash on delivery is the moment of handover** (NP codes 9/10), not the moment the
  money transfer is credited (code 11). This matches what the code already means by `delivered` for
  a COD order — «money collected» — and what the manager sees. The credit is recorded separately in
  `orders.np_money_transfer_at` and moves nothing.

- **One waybill per order.** Several boxes are *seats* (`SeatsAmount`) inside one waybill, one
  number to track. So the waybill lives in columns on `orders`, not in a table of its own.

- **`packed` is set by the fact of creating a waybill**, and deleting the waybill puts the order
  back. There is no button for it, and there does not need to be one: creating the waybill *is* the
  act of packing the order.

- **Manual entry of a waybill number stays.** It is not status management — it is recording a fact
  (the waybill was created in the Nova Poshta cabinet). Without it, an order whose waybill was made
  outside the panel could never be tracked.

## Constraints

- **No business account.** The client has no access to one and will register a personal Nova Poshta
  account for the API key. **The dev key already suffices for waybills** (checked 2026-08-07
  against the live API, not assumed): the key in `.dev.vars` has a sender counterparty
  («Приватна особа», `9e2a9945-…`) and a contact person (`9e2c1516-…`) behind it, so NP-2/NP-3
  can be driven end to end on the dev account before the client's key exists. That covers everything here except **cash on delivery (backward delivery,
  грошовий переказ), which requires a contract.** The code is written in full; the waybill form for a
  COD order refuses with «післяплата недоступна: не налаштований бізнес-акаунт» until the sender
  refs in settings are filled. Who pays the transfer commission is still an open Phase 0 item.
- **Sender configuration is data, not deployment.** Counterparty, contact person, phone, city and
  branch go in `settings`, because every one of them changes on the client's account in Phase 5 and
  the migration must not be a code change.
- **Print URLs carry the API key in the query string.** Nova Poshta's print endpoints take
  `.../apiKey/<key>`, so such a URL can never be rendered into a page. Printing goes through a proxy
  route in the admin Worker that adds the key server-side.
- **`NOVAPOSHTA_API_KEY` is not on the admin Worker yet** — it currently lives on `balier-cron`
  only. Adding it is a deploy step, not a code one.
- **The recipient name is one field.** Nova Poshta expects «Прізвище Ім'я» for a private person, and
  checkout only requires two characters. An order placed as «Аня» will not produce a waybill; the
  operator fixes it in the form. The storefront is deliberately not touched for this.
- **Testing creates real waybills** unless Nova Poshta's sandbox turns out to be usable (to be
  checked in NP-2). The fallback is create-then-delete: deletion works until the parcel is accepted
  at the branch.

## Phases

### Phase NP-1 — Schema and settings [done 2026-08-07]

- [x] Migration `0011` (`0011_bouncy_sumo.sql`, applied to the dev database and verified against
      `information_schema`):
      `product_variants.weight_grams` (integer, nullable);
      on `orders` — `np_ttn_ref`, `np_ttn_created_at`, `np_status_code`, `np_status_text`,
      `np_status_at`, `np_money_transfer_at`, `np_scan_sheet_ref`.
      `np_ttn` already exists and keeps its meaning (the printed number); `np_ttn_ref` is the
      internal document Ref, without which neither deletion nor printing is possible.
      `np_status_code` is **text**, not integer — what the carrier sent is recorded verbatim,
      never parsed into shape; only `applyCarrierStatus` (NP-4) interprets it.
- [x] Weight field in the product editor, on the variant row and on the add-variant form
      («Вага, г», placeholder «не зважено»). Blank is NULL, zero is refused —
      `optionalWholeNumber` in `validation/catalog.ts`, `WEIGHT_GRAMS_MAX = 100_000` as a typo
      guard.
- [x] `settings` keys for the sender (`np_sender_counterparty_ref`, `np_sender_contact_ref`,
      `np_sender_phone`, `np_sender_city_ref`, `np_sender_warehouse_ref`), `np_seat_dimensions`
      (one jsonb triple, cm — all three or none, `np_dimensions_incomplete` otherwise) and
      `np_cargo_description`. «Нова Пошта — відправник» section on `/settings`, rendered and
      accepted for the `admin` role only, every field optional (blank = NULL), refused NP form
      redrawn from the submitted body because five fields are pasted UUIDs. Accessors
      `getNpSenderSettings` / `setNpSenderSettings` in `db/queries/settings.ts`.

**Notes/decisions:** the sender settings screen has to survive being half-filled — the panel is
usable long before someone pastes a counterparty ref into it, and the waybill form is the place that
refuses, not the settings form.

### Phase NP-2 — The adapter [done 2026-08-07, live verification pending]

- [x] `ShippingPort` extended: `createWaybill`, `deleteWaybill`, `trackWaybills`,
      `waybillPrintUrl`, `createScanSheet`, `removeFromScanSheet`, `deleteScanSheet`,
      `scanSheetPrintUrl`, with the input/result types (`CreateWaybillInput` documents that
      `cityRef` is the **city** dictionary ref — `np_settlements.delivery_city_ref` — not the
      settlement ref the order stores; confusing them ships wrong without an API error).
      `WaybillOps` names the slice adapters actually implement; the pre-existing
      `searchSettlements`/`listWarehouses`/`quote` stay interface-only, as before.
      `client.ts` `methodProperties` widened to `Record<string, unknown>` for the nested
      `OptionsSeat`/`BackwardDeliveryData`/`Documents` arrays.
- [x] `novaposhta/waybill.ts` — pure `buildWaybillPayload` (always `WarehouseWarehouse`,
      `PayerType: Recipient`, `PaymentMethod: Cash`), `ensureRecipient` via `Counterparty.save`
      (refs deliberately not persisted — NP dedupes by phone+name on their side),
      `createWaybill`/`deleteWaybill`, `splitRecipientName` (one word → null → the form refuses),
      `toUahString` (kopiyka-exact — COD pays this out), `toKgString`, `kyivToday` (the API
      refuses a past `DateTime` and the Worker clock is UTC), print-URL builders.
- [x] `novaposhta/tracking.ts` — `trackWaybills` batched 100/call, `carrierStatusIntent` status
      table (moves only `shipped`/`delivered`; every unhappy code is an alert, never a
      transition; unknown codes confess `known: false`).
- [x] `novaposhta/scanSheet.ts` — insert/remove/delete + print URL. `getScanSheet`/list left
      unwritten until NP-5's screen shows what it actually renders.
- [x] `novaposhta/shipping.ts` — `createNovaPoshtaShipping(apiKey): WaybillOps`, the one place
      the key is closed over; domain code never sees it.
- [x] Tests (+21, 295 total): exact-value payload assertions, COD backward-delivery presence and
      amount, seats split, name splitting, Kyiv-midnight date roll, batching, and the
      alert-never-moves property asserted over the whole table.
- [x] **Live verification done** (2026-08-07, opening NP-3): two create-then-delete round trips on
      the dev key through the adapter's own modules (waybills `20451505720271` and
      `20451505721891`, both deleted, account left clean). Confirmed: `Counterparty.save`'s
      response shape, the whole `InternetDocument.save` field set incl. `OptionsSeat` (accepted
      as built), `delete` taking `DocumentRefs` as an **array**. Found and fixed: on a refusal
      the document methods return `errors` as an **object keyed by ref**, not an array — the
      client's `.join` crashed and ate the real message; `client.ts` now formats both shapes.
      `BackwardDeliveryData` stays unverifiable until a contract exists.

**Notes/decisions:** check for a Nova Poshta sandbox before writing the first live call, and record
the answer here — it decides how the rest of this plan gets driven.

**The sandbox answer (checked 2026-08-07): there is none for API 2.0.** Nova Poshta's only test
environment (`api-stage.novapost.pl`, test keys via api-portal.novapost.com) belongs to the new
international NovaPost REST API — a different protocol (JWT auth, REST routes), and its test-key
endpoint says outright that UA key generation is not supported. Nothing comparable exists for
`api.novaposhta.ua/v2.0`. So NP-3 is driven the fallback way: **real waybills on the dev key,
created and then deleted** — deletion works until the parcel is accepted at the branch.

Status-code homework done against public references while building `tracking.ts`: three codes the
plan's table missed — **41** (in the sender's city, local-service variant of 4), **14** (handed to
the recipient *for inspection* — still `shipped`, not `delivered`), **108** (refusal, alongside
102/103). All three are in the code's table; the live verification note below still stands.

### Phase NP-3 — Waybills in the panel [done 2026-08-07, driven live end to end]

- [x] «Створити ТТН» on the order screen («Нова Пошта» card, `[orderNumber].astro`). Destination
      and phone render read-only from the order; weight (summed over variants, editable), seats,
      dimensions, description and declared value are the operator's. The recipient *name* is
      editable in the form — «Аня» passes checkout and NP refuses one word — and never written
      back to the order. Refusals render in place with the submitted values kept: field errors
      under the form, the carrier's own sentence verbatim in a banner (`npErrorText`).
- [x] Declared value defaults to `itemsTotal`; COD backward delivery is the server-read `total`.
- [x] Creation: carrier first, then `attachWaybill` (`orders/waybill.ts`) — one transaction under
      `FOR UPDATE` writing `np_ttn` + `np_ttn_ref` + `np_ttn_created_at` + `packed`; refuses
      `ttn_exists` / `waybill_invalid_state`, and on a lost race the fresh carrier document is
      compensated away via `waitUntil` + delete.
- [x] «Видалити ТТН» — carrier first (their refusal leaves our record standing), then
      `detachWaybill`: clears every `np_*` column and reverts `packed` by `revertTarget`'s own
      rule. **Both directions driven live**: card order reverted to «Оплачено», COD to
      «Підтверджено».
- [x] Marking print through the proxy route `orders/[orderNumber]/marking` — fetched a real
      189 KB PDF through it; the key stays server-side.
- [x] Manual number entry stays, in the same card, labelled «створено в кабінеті НП» — and
      `setOrderTrackingNumber` now *refuses* (`ttn_managed`) while `np_ttn_ref` is set, so a
      panel-made waybill's number cannot be hand-edited out from under its ref (driven live).

**Driven 2026-08-07 against the dev server and the real API** (QA admin `qa-np@balier.test`,
disabled after): full create→print→delete on card order `B260806-P928J` (waybill
`20451505759029`) and on COD order `B260806-9ENGN` (`20451505760027`), both deleted, account
clean. Sender settings were saved through `/settings`' own form (phone normalised, dims stored as
one triple). Three live findings:

1. **`np_settlements.delivery_city_ref` had never been populated — for anything.** The column was
   designed against `getSettlements` returning `DeliveryCity`, which it does not (checked raw).
   Migration `0012` drops it and puts **`city_ref` on `np_warehouses`**, where the feed really
   carries it (`getWarehouses.CityRef`); the sync now maps it, the waybill reads the *warehouse's*
   city. Kyiv was backfilled by hand in dev; **the rest of the country fills on the next full
   sync** — see the deploy steps.
2. **NP accepted COD backward delivery on the personal dev key** — `BackwardDeliveryData
   CargoType: Money` did not need a business contract to *create* the waybill. Whether the money
   transfer actually pays out at handover on a personal account is a different question the
   plan's «Constraints» stance still covers; the create-time refusal the plan predicted simply
   did not happen.
3. **NP refuses Latin recipient names** («FirstName has invalid characters») — the verbatim
   banner surfaced it exactly as intended; names must be Cyrillic.

### Phase NP-4 — Status synchronisation [todo]

- [ ] Cron every 15–30 minutes: every order with a waybill in a non-final status, batched into
      `TrackingDocument`, mapped through a new `applyCarrierStatus`.
- [ ] `applyCarrierStatus` uses the existing state machine but is allowed only
      `packed → shipped → delivered`. `paid` stays webhook-only (hard rule 2); `cancelled` and
      `refunded` stay human-only.
- [ ] Rewrite `orders/status.ts` and its tests: `allowedTransitions` returns only the exit action
      for the panel. The forward chain becomes carrier-driven and is asserted as such.
- [ ] Manager alerts to Telegram, none of which move an order:
      refusal / storage ended / failed delivery / return to sender (102, 103, 105, 106, 111);
      «номер не знайдено» (3), which means a mistyped or deleted waybill;
      and the **stuck-order alert** — an order in `paid`/`confirmed` for more than N days with no
      waybill. That alert is what stands in for the removed buttons: with no manual way forward,
      silence must not look like everything being fine.

**Notes/decisions:** automation that cancels an order on a carrier code will eventually cancel a
paid one. Every unhappy code is an alert, never a transition.

Intended mapping — **verify each code against the live API before relying on it**; the table is the
intent, the code is the truth:

| NP status | meaning | order |
| --- | --- | --- |
| 1 | waybill created, parcel not handed over | stays `packed` |
| 2 | deleted (in the NP cabinet — panel deletions clear our record themselves) | **detach**: clear the waybill columns and revert `packed` the way «Видалити ТТН» does; alert so the deletion is noticed. Asked for 2026-08-07 after a cabinet deletion left a dead record behind |
| 3 | number not found | no move, alert |
| 12, 4, 5, 6, 7, 8, 101, 104, 112 | in transit, arrived at branch or locker | `shipped` |
| 9, 10 | received | `delivered` |
| 11 | received, money transfer credited | `delivered` + `np_money_transfer_at` |
| 102, 103, 105, 106, 111 | refusal, storage ended, return, failed attempt | no move, alert |

### Phase NP-5 — Register of shipments [todo]

- [ ] Selection on `/orders` (waybilled orders only) → «Створити реєстр».
- [ ] Register storage and the order↔register link, print, delete, and removing a single order from
      a register.

**Notes/decisions:** this is the phase that answers the original request literally — what the seller
hands over at the branch. It can swap places with NP-4 if the counter workflow matters more than
removing manual statuses.

## Deployment steps (not code)

- [ ] `wrangler secret put NOVAPOSHTA_API_KEY` on `balier-admin-dev` (it is in
      `apps/admin/.dev.vars` already, so local dev works today).
- [x] Migrations `0011` **and `0012`** applied **before** the admin deploy — the order screen reads
      the new columns on every request. (Both applied to the dev database 2026-08-07, ahead of any
      deploy of this code.)
- [x] Sender settings filled in on `/settings` before the first waybill. (Dev: filled 2026-08-07
      through the form itself — sender city/warehouse currently point at **Київ, Відділення №1**
      as a working placeholder; correct them to the real handover branch before real shipments.)
- [ ] **`balier-cron` redeploy, then one full sync** — needed *before* NP-4, and now also what
      fills `np_warehouses.city_ref` country-wide (only Kyiv is backfilled in dev). Until a
      settlement's branches have it, its orders show the «немає міста… синхронізація» blocker
      instead of the create form.

## Open questions

- Does Nova Poshta offer a usable sandbox for `InternetDocument.save`? Decides how NP-3 is driven.
- Exact `OptionsSeat` requirements for parcel-locker delivery — dimensions are required, the precise
  field set is to be read off the API.
- Stuck-order alert threshold (N days) — a constant to start with, a setting only if it turns out to
  need tuning.

## Out of scope (for now)

- **Delivery cost quoting.** Settled on 2026-08-03: the recipient pays the carrier's own tariff and
  nothing about delivery enters an order total. `ShippingPort.quote` stays unused.
- **Several waybills per order.** One order, one waybill; revisit only if partial shipments become
  real, and it means a `np_waybills` table rather than columns.
- **Courier delivery.** Withdrawn 2026-08-06 at checkout; the enum value survives for historical
  orders only.
- **Telling the customer that a parcel shipped.** Still the undecided item recorded in Phase 4 of
  the roadmap — with statuses now moving automatically it gets easier to build and no less of a
  decision about what the shop says to people.
