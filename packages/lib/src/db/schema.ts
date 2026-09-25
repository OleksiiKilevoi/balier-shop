import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * Conventions enforced across this file:
 *  - All money is an INTEGER number of kopiykas. Never numeric/float.
 *  - Every product has >= 1 row in `productVariants`. Stock lives on the variant.
 *  - User-facing text lives in `*_translations` tables keyed by locale.
 */

export const locale = pgEnum('locale', ['uk', 'ru', 'en']);
export const productStatus = pgEnum('product_status', ['draft', 'active', 'archived']);
export const orderStatus = pgEnum('order_status', [
  'pending',
  'awaiting_payment',
  'paid',
  'confirmed',
  'packed',
  'shipped',
  /**
   * The parcel is at the destination branch or locker, waiting to be picked up
   * (NP codes 7/8, panel label «Доставлено»). Split out of `shipped` on
   * 2026-08-07 at the client's request; `delivered` stays the *handover*
   * («Отримано») — the distinction matters exactly because a COD parcel at the
   * branch is not yet money.
   */
  'arrived',
  'delivered',
  'cancelled',
  'refunded',
]);
/**
 * Nova Poshta's parcel tiers. Replaced per-variant grams on 2026-09-18: the
 * shop packs into two boxes and the tier is what the carrier charges by, so a
 * weight nobody measured was only ever standing in for this choice.
 */
export const parcelSize = pgEnum('parcel_size', ['small', 'large']);
export const paymentMethod = pgEnum('payment_method', ['card', 'cod', 'parts']);
export const deliveryMethod = pgEnum('delivery_method', [
  'np_warehouse',
  'np_postomat',
  'np_courier',
]);
export const paymentProvider = pgEnum('payment_provider', ['monobank', 'monobank_parts']);

/**
 * What an admin account may do. Two values, and deliberately not a permission
 * matrix: the shop has a handful of accounts, and the only thing the two roles
 * differ on is whether you may create and change accounts.
 *
 * `manager` is everything the panel is for — orders, the catalog, the shop
 * settings. `admin` is that plus the «Користувачі» section of `/settings`.
 * Ordered least-privileged first, which is also the column's default.
 */
export const adminRole = pgEnum('admin_role', ['manager', 'admin']);
export const reviewStatus = pgEnum('review_status', ['pending', 'published', 'rejected']);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ catalog */

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  position: integer('position').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt,
  updatedAt,
});

export const categoryTranslations = pgTable(
  'category_translations',
  {
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    locale: locale('locale').notNull(),
    title: text('title').notNull(),
    description: text('description'),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.locale] })],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    /** Kopiykas. A variant may override this. */
    basePrice: integer('base_price').notNull(),
    /**
     * Free-form, as written on the product card: `30х17х10 см`, `19х11 см`.
     * Not translated — the digits carry the meaning and `см` reads the same in
     * every locale we plan to ship. Rendered as its own block on the product page.
     */
    dimensions: text('dimensions'),
    /** Which box it ships in — `small` («до 2 кг») unless the owner says otherwise. */
    parcelSize: parcelSize('parcel_size').notNull().default('small'),
    status: productStatus('status').notNull().default('draft'),
    isFeatured: boolean('is_featured').notNull().default(false),
    position: integer('position').notNull().default(0),
    /** The bundle discount on every companion in `product_companions` (`~/lib/cart/bundle.ts`). */
    companionDiscountPercent: integer('companion_discount_percent').notNull().default(10),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('products_status_idx').on(t.status),
    index('products_category_idx').on(t.categoryId),
    check('products_companion_discount_range', sql`${t.companionDiscountPercent} between 0 and 50`),
  ],
);

/**
 * The upsell list: companions offered under a product and at checkout, each
 * priced `products.companion_discount_percent` lower for as many units as the
 * main product has in the cart (`~/lib/cart/bundle.ts`). Shown in the order
 * they were added.
 */
export const productCompanions = pgTable(
  'product_companions',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    companionProductId: uuid('companion_product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.companionProductId] }),
    check('product_companions_not_self', sql`${t.productId} <> ${t.companionProductId}`),
  ],
);

export const productTranslations = pgTable(
  'product_translations',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locale: locale('locale').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** Free-form care/material notes rendered as a list. */
    details: text('details'),
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
  },
  (t) => [primaryKey({ columns: [t.productId, t.locale] })],
);

/**
 * Always at least one row per product. A product with no colour choice has a
 * single variant with `colorName = null`; the UI hides the selector for it.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull().unique(),
    /** Ukrainian colour name shown in the picker. NULL = product has no variations. */
    colorName: text('color_name'),
    /** Hex swatch for the picker, e.g. `#1a1a1a`. */
    colorHex: text('color_hex'),
    /** Kopiykas. NULL means "use products.base_price". */
    priceOverride: integer('price_override'),
    /**
     * Is this colour on sale right now? A flag rather than a count, decided
     * 2026-08-10: the shop's stock is one-off pieces a person keeps in their
     * head, and a number nobody updates is worse than no number. Nothing
     * decrements it — an order does not change availability, only a manager
     * does, so two customers *can* buy the last bag. That risk was raised and
     * accepted; the manager confirms every order by hand anyway.
     *
     * Distinct from `isActive`: this one is «закінчилось, буде ще», the other
     * is «цього кольору більше не існує» and hides the variant from the picker
     * entirely.
     */
    inStock: boolean('in_stock').notNull().default(true),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [index('product_variants_product_idx').on(t.productId)],
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** NULL = shared by every variant. Set = belongs to that colour only. */
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    alt: text('alt'),
    width: integer('width'),
    height: integer('height'),
    position: integer('position').notNull().default(0),
    createdAt,
  },
  (t) => [index('product_images_product_idx').on(t.productId)],
);

/* ------------------------------------------------------------------- orders */

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-readable, also sent to Monobank as `merchantPaymInfo.reference`. */
    orderNumber: text('order_number').notNull().unique(),
    status: orderStatus('status').notNull().default('pending'),

    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: text('customer_email'),

    deliveryMethod: deliveryMethod('delivery_method').notNull(),
    npSettlementRef: text('np_settlement_ref'),
    npSettlementName: text('np_settlement_name'),
    npWarehouseRef: text('np_warehouse_ref'),
    npWarehouseName: text('np_warehouse_name'),
    /** Only for courier delivery. */
    npAddress: text('np_address'),
    /** Nova Poshta tracking number, set when the parcel is created. */
    npTtn: text('np_ttn'),
    /**
     * The waybill's internal document Ref at Nova Poshta. `npTtn` above stays
     * the printed 14-digit number; this is what deletion and printing take.
     * NULL with `npTtn` set means the number was recorded by hand — a waybill
     * made in the NP cabinet — and such an order can be tracked but its waybill
     * cannot be deleted or printed from the panel.
     */
    npTtnRef: text('np_ttn_ref'),
    npTtnCreatedAt: timestamp('np_ttn_created_at', { withTimezone: true }),
    /**
     * Last tracking status, verbatim from the carrier — the code as NP sent it
     * (text, not integer: what the API returns is recorded, never parsed into
     * shape), the human sentence next to it, and when the sync saw it. Display
     * and diagnosis only; the order's own `status` is what the state machine
     * moves, and only `applyCarrierStatus` maps one onto the other.
     */
    npStatusCode: text('np_status_code'),
    npStatusText: text('np_status_text'),
    npStatusAt: timestamp('np_status_at', { withTimezone: true }),
    /**
     * COD only: when tracking first reported code 11 — the money transfer
     * credited to the seller. Recorded because the money matters, but it moves
     * nothing: `delivered` is the handover (codes 9/10), which is what the word
     * already means for a COD order.
     */
    npMoneyTransferAt: timestamp('np_money_transfer_at', { withTimezone: true }),
    /** Ref of the register of shipments (ScanSheet) this waybill is on, if any. */
    npScanSheetRef: text('np_scan_sheet_ref'),

    paymentMethod: paymentMethod('payment_method').notNull(),

    /**
     * All kopiykas. `total = items_total − discount_total + delivery_total` is
     * what the customer pays and what Monobank is charged.
     */
    itemsTotal: integer('items_total').notNull(),
    /** The promo code redeemed on this order, verbatim, or NULL. */
    promoCode: text('promo_code'),
    discountTotal: integer('discount_total').notNull().default(0),
    deliveryTotal: integer('delivery_total').notNull().default(0),
    total: integer('total').notNull(),

    comment: text('comment'),

    createdAt,
    updatedAt,
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /**
     * The status this order held immediately before it became `cancelled` or
     * `refunded` — written only by the admin panel's own write path
     * (`~/lib/orders/updateStatus.ts`), never by the webhook or checkout's own
     * cancellation paths (those only ever cancel from `pending`/
     * `awaiting_payment`, which is never a useful revert target — see
     * `~/lib/orders/status.ts`). `null` outside `cancelled`/`refunded`, and
     * cleared back to `null` on a successful revert out of either.
     */
    statusBeforeExit: orderStatus('status_before_exit'),
    /**
     * The secret in the customer's «залиште відгук» link (`/review/<token>`).
     * Random per order, so the link needs no signing key; the page only opens
     * for a `delivered` order.
     */
    reviewToken: uuid('review_token').notNull().unique().defaultRandom(),
    /** When the cron claimed this order's review e-mail — set once, so a revert and re-advance to `delivered` never sends it twice. */
    reviewRequestedAt: timestamp('review_requested_at', { withTimezone: true }),
  },
  (t) => [index('orders_status_idx').on(t.status), index('orders_created_at_idx').on(t.createdAt)],
);

/**
 * Product/variant text and price are SNAPSHOTTED at order time. Never join back
 * to the catalog to render a historical order — prices and names change.
 */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    productSlug: text('product_slug').notNull(),
    productTitle: text('product_title').notNull(),
    variantName: text('variant_name'),
    sku: text('sku').notNull(),
    /** Kopiykas, per unit, at the moment of ordering. */
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
    /** Kopiykas. unitPrice * quantity, stored so totals never drift. */
    lineTotal: integer('line_total').notNull(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

/*
 * `stock_reservations` lived here until 2026-08-10. It held "how much of this
 * variant is spoken for" against a counted `product_variants.stock`, and both
 * went when availability became a flag: there is no number left to hold back,
 * so an unpaid order reserves nothing. What the table also did — mark how long
 * an unpaid card order may sit — is now `orders.created_at` measured against
 * the `payment_ttl_minutes` setting, read by the cron's own sweep.
 */

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: paymentProvider('provider').notNull().default('monobank'),
    /** Unique — this is what makes webhook delivery idempotent. */
    invoiceId: text('invoice_id').notNull().unique(),
    /** Raw provider status: created | processing | hold | success | failure | reversed | expired. */
    status: text('status').notNull(),
    /** Kopiykas. */
    amount: integer('amount').notNull(),
    /**
     * The provider's hosted payment page, captured when the invoice is created.
     *
     * Stored rather than shown once and forgotten, because an order created in
     * the admin panel has no browser to redirect: the manager has to *send* this
     * link to a customer who is talking to them on Telegram, and may well need
     * it again a minute later. NULL for anything created before this column
     * existed, and for a provider that does not hand back a URL.
     *
     * Deliberately not folded into `lastPayload`, which every webhook
     * overwrites — the link would vanish on the first `processing` callback,
     * which is exactly while it is still needed.
     */
    pageUrl: text('page_url'),
    /** Last webhook/status payload, kept for support and disputes. */
    lastPayload: jsonb('last_payload'),
    createdAt,
    updatedAt,
  },
  (t) => [index('payments_order_idx').on(t.orderId)],
);

/**
 * A register of shipments (реєстр відправлень / ScanSheet) — the one document
 * for a whole handover batch, so the branch scans one barcode instead of
 * accepting each parcel separately. Orders point at their register through
 * `orders.np_scan_sheet_ref`; this row exists so the panel can list registers
 * and print them offline from the carrier (`number` is what the API returns
 * once, at creation, and `ScanSheet.getScanSheet` is otherwise the only way to
 * get it back). Deliberately no FK from `orders` — every other `np_*` ref on an
 * order is opaque carrier data, and this one stays consistent with them.
 */
export const npScanSheets = pgTable('np_scan_sheets', {
  /** The carrier's own document Ref — deletion and printing take it. */
  ref: text('ref').primaryKey(),
  /** The printed register number, e.g. `105-…` — what the branch sees. */
  number: text('number').notNull(),
  createdAt,
});

/* ------------------------------------------------------- nova poshta cache */

export const npSettlements = pgTable(
  'np_settlements',
  {
    ref: text('ref').primaryKey(),
    name: text('name').notNull(),
    area: text('area'),
    region: text('region'),
    type: text('type'),
    /**
     * Denormalised count of `np_warehouses` rows for this settlement, refreshed by
     * the same sync that populates both tables. NP's `getSettlements` has no
     * population/importance field, but warehouse count is a solid proxy — a real
     * city has hundreds, a village has 0–1 — used to rank `/checkout`'s settlement
     * search so "Київ" surfaces before an obscure village whose name also matches.
     */
    warehouseCount: integer('warehouse_count').notNull().default(0),
    /**
     * `DescriptionRu` / `DescriptionTranslit` straight from NP's
     * `getSettlements` — both are in every response and were simply being
     * discarded before. They matter because the hard cases are not typos but
     * different words: «Львів»/«Львов», «Миколаїв»/«Николаев». Kept as their
     * own columns (rather than only folded into `search_text`) so a result can
     * one day be *labelled* in the language the customer typed.
     */
    nameRu: text('name_ru'),
    nameTranslit: text('name_translit'),
    /**
     * All spellings above, folded by `src/novaposhta/normalize.ts` into one
     * blob — this is what `/checkout`'s settlement search actually matches
     * against, via the GIN trigram index below. Never rendered.
     */
    searchText: text('search_text').notNull().default(''),
    updatedAt,
  },
  (t) => [
    index('np_settlements_name_idx').on(t.name),
    /**
     * A leading-wildcard `ilike '%q%'` cannot use a btree, so the search was a
     * seq scan over all 26 791 rows on every keystroke (8.9 ms, measured).
     * `gin_trgm_ops` indexes it, and is also what makes the typo-tolerant
     * `word_similarity` fallback in `db/queries/novaposhta.ts` affordable.
     */
    index('np_settlements_search_idx').using('gin', t.searchText.op('gin_trgm_ops')),
  ],
);

export const npWarehouses = pgTable(
  'np_warehouses',
  {
    ref: text('ref').primaryKey(),
    settlementRef: text('settlement_ref').notNull(),
    /**
     * The branch's ref in NP's **city** dictionary (`getCities`) — a different
     * dictionary from the settlement one, and the ref `InternetDocument.save`
     * takes as `CityRecipient`. Lives on the warehouse because that is where
     * the feed actually provides it: `getSettlements` has no such field (found
     * 2026-08-07 when every `delivery_city_ref` turned out NULL — that column
     * was designed against data that does not exist, and is gone). NULL until
     * the first sync with this column runs; the waybill form refuses then.
     */
    cityRef: text('city_ref'),
    number: text('number'),
    /**
     * `number` is what NP prints on the branch, and it is text because a few
     * are not plain integers. Ordering by it lexicographically listed Kyiv as
     * 1, 10, 10063, 10064, …, 101 — so the numeric value gets its own column
     * to sort on, NULL for the handful that have no number at all.
     */
    numberSort: integer('number_sort'),
    description: text('description').notNull(),
    /** Ukrainian branch description; `descriptionRu` is NP's `DescriptionRu`. */
    descriptionRu: text('description_ru'),
    /** Both descriptions folded for search — see `np_settlements.search_text`. */
    searchText: text('search_text').notNull().default(''),
    /** Branch vs parcel locker, from `TypeOfWarehouse`. */
    typeRef: text('type_ref'),
    /**
     * Resolved once at sync time from `type_ref`'s description. The pickers
     * used to re-derive this per query with `type_ref ilike '%поштомат%'`,
     * which no index can serve — Kyiv scanned 7 767 rows to return 50.
     */
    isPostomat: boolean('is_postomat').notNull().default(false),
    maxWeightKg: integer('max_weight_kg'),
    latitude: text('latitude'),
    longitude: text('longitude'),
    /**
     * From NP's `WarehouseStatus` and `DenyToSelect`. The sync used to hardcode
     * this to `true` for every row, so closed branches stayed selectable at
     * checkout and the `is_active` filter below was decorative.
     */
    isActive: boolean('is_active').notNull().default(true),
    updatedAt,
  },
  (t) => [
    /**
     * Covers the picker's whole WHERE and its ORDER BY in one index: every
     * warehouse lookup is scoped to a settlement, a kind, and active-only.
     */
    index('np_warehouses_lookup_idx').on(t.settlementRef, t.isPostomat, t.isActive, t.numberSort),
  ],
);

/**
 * Scratch space for one warehouse sync run: the ref of every branch the feed
 * returned, truncated at the start of each run.
 *
 * It exists because retirement used to be inferred from `np_warehouses.updated_at`
 * — "anything the run didn't touch is gone from the feed" — which only worked
 * because the sync rewrote every row every night. That rewrite is what made the
 * database ten times bigger than its data, and Postgres cannot touch a row's
 * timestamp without writing the whole 800-byte row again, so there is no cheap
 * in-place "seen" mark. A 36-byte ref per branch is ~2 MB against ~45 MB.
 *
 * Deliberately without an index: it is written once and read once per run, by an
 * anti-join that hashes it whole. It assumes one sync at a time, which the daily
 * cron guarantees.
 */
export const npSyncSeen = pgTable('np_sync_seen', {
  ref: text('ref').notNull(),
});

/* -------------------------------------------------------- content & config */

export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  isPublished: boolean('is_published').notNull().default(false),
  position: integer('position').notNull().default(0),
  createdAt,
  updatedAt,
});

export const pageTranslations = pgTable(
  'page_translations',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    locale: locale('locale').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    metaDescription: text('meta_description'),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.locale] })],
);

/** Key/value store for admin-editable settings, e.g. the cash-on-delivery limit. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt,
});

/* -------------------------------------------------------------------- admin */

/**
 * Who may open `/admin`. The panel authenticates against this table rather than
 * against an edge product, so the business owns its own admins: adding one is a
 * row, not a dashboard, and the panel keeps working when it is lifted into the
 * next project on a different account.
 *
 * `passwordHash` is a self-describing PBKDF2 string from `~/lib/auth/password`
 * — never a raw password, and never reversible. `email` is stored lower-cased;
 * `normalizeEmail` there is the only thing that writes or looks it up.
 *
 * Access is taken away in two steps, and they mean different things.
 * `isActive` is the pause — the person is still on the team, the row stays in
 * the panel's list, and switching it back on is one click. `archivedAt` is the
 * removal: the row leaves the list for the «Архів» tab, keeps `lastLoginAt` as
 * the record that the account was ever used, and can still be restored. Only
 * from that tab can a row be dropped for good, which is the one thing that
 * frees the address for re-use.
 */
/**
 * Fixed-window attempt counters that have to be *true*, not approximate.
 *
 * The KV limiter (`~/lib/rateLimit`) is a read-modify-write with no increment
 * primitive, so parallel requests share one unit and a cross-colo guesser sees
 * a stale count for up to a minute. That is fine where a budget only deters
 * abuse, and not fine on the admin password form, where the budget *is* the
 * gate (audit, 2026-09-22). Postgres has an atomic upsert, and the login form
 * already talks to this database on the same request.
 *
 * `key` is the whole identity of a budget, e.g. `admin-login:<ip>`; a window
 * that has run out is reset by the upsert itself rather than by a sweeper, and
 * `workers/cron` drops long-dead rows nightly so a spraying attacker cannot
 * grow the table forever.
 */
export const authAttempts = pgTable('auth_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
});
export type AuthAttempt = typeof authAttempts.$inferSelect;

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  /** Shown in the panel header. NULL falls back to the email. */
  name: text('name'),
  passwordHash: text('password_hash').notNull(),
  /**
   * What the account may do beyond the panel's day job. See `adminRole` — the
   * default is the lesser of the two on purpose, so a row created by any path
   * that does not name a role cannot hand out the right to create accounts.
   */
  role: adminRole('role').notNull().default('manager'),
  isActive: boolean('is_active').notNull().default(true),
  /**
   * Every session token minted before this instant is refused. The whole of
   * session revocation, in one column — see `sessionStillValid` in
   * `~/auth/session`. Bumped on a password change and on being switched off;
   * *not* bumped by a role change, which is not a reason to sign somebody out.
   */
  sessionsValidFrom: timestamp('sessions_valid_from', { withTimezone: true })
    .notNull()
    .defaultNow(),
  /**
   * Set when the account is removed from the panel's list. NULL is the normal
   * state, so every reader that forgets the filter sees the live accounts —
   * the safe half of the mistake.
   *
   * An archived row cannot sign in whatever `isActive` says: both login
   * readers require this to be NULL. `isActive` is left exactly as it was, so
   * «Відновити» puts the account back in the state it was removed in rather
   * than silently re-enabling one that was already switched off.
   */
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /**
   * The private chat the bot may send login codes to, set only by the
   * `/telegram/webhook` handshake — never typed in. Unique because a chat that
   * answers codes for two accounts would let either sign in as the other.
   * NULL means Telegram sign-in is simply not offered for this account.
   */
  telegramChatId: text('telegram_chat_id').unique(),
  /**
   * One pending deep-link handshake (`t.me/<bot>?start=<code>`), minted on
   * `/settings` and consumed by the webhook. A new link replaces the old one —
   * an account has one pending invitation, not a collection.
   */
  telegramLinkCode: text('telegram_link_code').unique(),
  telegramLinkExpiresAt: timestamp('telegram_link_expires_at', { withTimezone: true }),
  /**
   * The current sign-in code, HMAC'd under `ADMIN_SESSION_SECRET` — never the
   * six digits themselves, so a database read alone cannot sign anybody in.
   * `otpAttempts` is counted *in SQL* on every guess (`claimOtpAttempt`), which
   * is what makes five attempts mean five: checking in JS and writing after
   * would let parallel guesses share one attempt.
   */
  otpHash: text('otp_hash'),
  otpExpiresAt: timestamp('otp_expires_at', { withTimezone: true }),
  otpAttempts: integer('otp_attempts').notNull().default(0),
  createdAt,
  updatedAt,
});

/* ---------------------------------------------------------------- relations */

export const categoriesRelations = relations(categories, ({ many }) => ({
  translations: many(categoryTranslations),
  products: many(products),
}));

export const categoryTranslationsRelations = relations(categoryTranslations, ({ one }) => ({
  category: one(categories, {
    fields: [categoryTranslations.categoryId],
    references: [categories.id],
  }),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  translations: many(productTranslations),
  variants: many(productVariants),
  images: many(productImages),
}));

export const productTranslationsRelations = relations(productTranslations, ({ one }) => ({
  product: one(products, { fields: [productTranslations.productId], references: [products.id] }),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  images: many(productImages),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [productImages.variantId],
    references: [productVariants.id],
  }),
}));

export const ordersRelations = relations(orders, ({ many }) => ({
  items: many(orderItems),
  payments: many(payments),
}));

/**
 * One row per person who asked the storefront's popup for a discount: the
 * e-mail the code went to, the code itself, and the order that redeemed it.
 * A code is spent by a live order; a cancelled order hands it back
 * (`~/lib/db/queries/promo.ts`). E-mails are unique on purpose — asking twice
 * returns the same code, so «one per person» is one per address.
 */
export const promoCodes = pgTable(
  'promo_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lower-cased. */
    email: text('email').notNull().unique(),
    code: text('code').notNull().unique(),
    /** The percentage promised in the e-mail — frozen, so a later settings change keeps old promises. */
    percent: integer('percent').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    createdAt,
  },
);
export type PromoCode = typeof promoCodes.$inferSelect;

/**
 * A buyer's review of one product from one delivered order — «Перевірена
 * покупка» by construction, since the only way in is the order's review link.
 * Nothing is public until a manager publishes it in the panel.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    authorName: text('author_name').notNull(),
    rating: integer('rating').notNull(),
    body: text('body'),
    status: reviewStatus('status').notNull().default('pending'),
    createdAt,
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    unique('reviews_order_product_unique').on(t.orderId, t.productId),
    index('reviews_product_status_idx').on(t.productId, t.status),
    check('reviews_rating_range', sql`${t.rating} between 1 and 5`),
  ],
);
export type Review = typeof reviews.$inferSelect;
export type ReviewStatus = (typeof reviewStatus.enumValues)[number];

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const pagesRelations = relations(pages, ({ many }) => ({
  translations: many(pageTranslations),
}));

export const pageTranslationsRelations = relations(pageTranslations, ({ one }) => ({
  page: one(pages, { fields: [pageTranslations.pageId], references: [pages.id] }),
}));

/* -------------------------------------------------------------------- types */

export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminRole = (typeof adminRole.enumValues)[number];
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Locale = (typeof locale.enumValues)[number];
export type ProductStatus = (typeof productStatus.enumValues)[number];
export type ParcelSize = (typeof parcelSize.enumValues)[number];
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type DeliveryMethod = (typeof deliveryMethod.enumValues)[number];
