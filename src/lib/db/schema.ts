import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
  'delivered',
  'cancelled',
  'refunded',
]);
export const paymentMethod = pgEnum('payment_method', ['card', 'cod']);
export const deliveryMethod = pgEnum('delivery_method', [
  'np_warehouse',
  'np_postomat',
  'np_courier',
]);
export const paymentProvider = pgEnum('payment_provider', ['monobank']);

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
    /** Kopiykas. Crossed-out "old" price, shown only when set and higher than the effective price. */
    compareAtPrice: integer('compare_at_price'),
    /**
     * Free-form, as written on the product card: `30х17х10 см`, `19х11 см`.
     * Not translated — the digits carry the meaning and `см` reads the same in
     * every locale we plan to ship. Rendered as its own block on the product page.
     */
    dimensions: text('dimensions'),
    status: productStatus('status').notNull().default('draft'),
    isFeatured: boolean('is_featured').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [index('products_status_idx').on(t.status), index('products_category_idx').on(t.categoryId)],
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
    /** Physical units on hand. Availability = stock - active reservations. */
    stock: integer('stock').notNull().default(0),
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

    paymentMethod: paymentMethod('payment_method').notNull(),

    /** All kopiykas. `total` is what the customer pays and what Monobank is charged. */
    itemsTotal: integer('items_total').notNull(),
    deliveryTotal: integer('delivery_total').notNull().default(0),
    total: integer('total').notNull(),

    comment: text('comment'),

    createdAt,
    updatedAt,
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
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

/**
 * Single source of truth for "how much of this variant is spoken for".
 * Availability = variant.stock - SUM(quantity) WHERE expires_at > now().
 * A cron deletes expired rows (Phase 3).
 */
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [
    index('stock_reservations_variant_idx').on(t.variantId),
    index('stock_reservations_expires_idx').on(t.expiresAt),
  ],
);

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
    /** Last webhook/status payload, kept for support and disputes. */
    lastPayload: jsonb('last_payload'),
    createdAt,
    updatedAt,
  },
  (t) => [index('payments_order_idx').on(t.orderId)],
);

/* ------------------------------------------------------- nova poshta cache */

export const npSettlements = pgTable(
  'np_settlements',
  {
    ref: text('ref').primaryKey(),
    name: text('name').notNull(),
    area: text('area'),
    region: text('region'),
    type: text('type'),
    /** Ref used by delivery-cost lookups; not every settlement has one. */
    deliveryCityRef: text('delivery_city_ref'),
    updatedAt,
  },
  (t) => [index('np_settlements_name_idx').on(t.name)],
);

export const npWarehouses = pgTable(
  'np_warehouses',
  {
    ref: text('ref').primaryKey(),
    settlementRef: text('settlement_ref').notNull(),
    number: text('number'),
    description: text('description').notNull(),
    /** Branch vs parcel locker, from `TypeOfWarehouse`. */
    typeRef: text('type_ref'),
    maxWeightKg: integer('max_weight_kg'),
    latitude: text('latitude'),
    longitude: text('longitude'),
    isActive: boolean('is_active').notNull().default(true),
    updatedAt,
  },
  (t) => [index('np_warehouses_settlement_idx').on(t.settlementRef)],
);

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
  reservations: many(stockReservations),
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
  reservations: many(stockReservations),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const stockReservationsRelations = relations(stockReservations, ({ one }) => ({
  order: one(orders, { fields: [stockReservations.orderId], references: [orders.id] }),
  variant: one(productVariants, {
    fields: [stockReservations.variantId],
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

export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Locale = (typeof locale.enumValues)[number];
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type DeliveryMethod = (typeof deliveryMethod.enumValues)[number];
