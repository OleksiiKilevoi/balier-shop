import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db, Tx, TxDb } from '../index';
import type { Order, OrderItem, OrderStatus, Payment } from '../schema';
import { orderItems, orders, productVariants } from '../schema';
import type { Kopiykas } from '../../money';
import { likeContains } from './like';

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

/** `/checkout/success`: the order plus its snapshotted line items. */
export async function findOrderByNumber(
  db: Db | TxDb | Tx,
  orderNumber: string,
): Promise<OrderWithItems | null> {
  const order = await db.query.orders.findFirst({
    where: (orders, { eq: eqCol }) => eqCol(orders.orderNumber, orderNumber),
    with: { items: true },
  });
  return order ?? null;
}

export interface OrderForAdmin extends Order {
  items: OrderItem[];
  /** Empty for cash on delivery — no invoice is ever created. */
  payments: Payment[];
}

/**
 * The admin order detail page. Unlike `findOrderByNumber` this carries the
 * payment rows too, so the panel can show what Monobank thinks alongside what
 * we think — the pair that told us the webhook was failing, back when it was.
 */
export async function findAdminOrder(
  db: Db | TxDb | Tx,
  orderNumber: string,
): Promise<OrderForAdmin | null> {
  const order = await db.query.orders.findFirst({
    where: (o, { eq: eqCol }) => eqCol(o.orderNumber, orderNumber),
    with: { items: true, payments: true },
  });
  return order ?? null;
}

/**
 * What each line of an order weighs — the waybill form's starting point.
 *
 * The one deliberate join back from an order to the live catalog: unlike the
 * title and price, weight was never snapshotted at order time (the column is
 * newer than most orders), and the physical parcel is being weighed *now*, so
 * the variant's current number is the more honest starting value. It is only a
 * prefill — the operator confirms or corrects it on the form.
 *
 * `weightGrams` NULL means the variant was never weighed; the form refuses to
 * prefill a guessed total and names these lines instead (no silent default —
 * docs/plans/novaposhta.md).
 */
export interface OrderItemWeight {
  productTitle: string;
  variantName: string | null;
  quantity: number;
  weightGrams: number | null;
}

export async function getOrderItemWeights(db: Db, orderId: string): Promise<OrderItemWeight[]> {
  return db
    .select({
      productTitle: orderItems.productTitle,
      variantName: orderItems.variantName,
      quantity: orderItems.quantity,
      weightGrams: productVariants.weightGrams,
    })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(eq(orderItems.orderId, orderId));
}

/**
 * The orders whose waybill NP-4's tracking tick asks the carrier about.
 *
 * `packed` and `shipped` are tracked as long as they last — each needs the
 * carrier (or a human, alerted) to resolve it, so there is no honest cutoff.
 * A *delivered* COD order is tracked only for its code 11 (the money transfer
 * credited, `npMoneyTransferAt`), and only for 30 days past its last movement:
 * a credit that has not arrived a month after handover is not going to be
 * noticed by polling — and on a personal NP account it never arrives at all,
 * which without the cutoff would mean tracking every delivered order forever.
 */
export interface TrackedWaybillOrder {
  orderNumber: string;
  npTtn: string;
}

export async function listWaybillOrdersToTrack(db: Db): Promise<TrackedWaybillOrder[]> {
  const rows = await db
    .select({ orderNumber: orders.orderNumber, npTtn: orders.npTtn })
    .from(orders)
    .where(
      and(
        isNotNull(orders.npTtn),
        or(
          inArray(orders.status, ['packed', 'shipped']),
          and(
            eq(orders.status, 'delivered'),
            eq(orders.paymentMethod, 'cod'),
            isNull(orders.npMoneyTransferAt),
            sql`coalesce(${orders.npStatusAt}, ${orders.npTtnCreatedAt}) > now() - interval '30 days'`,
          ),
        ),
      ),
    );

  return rows.filter((row): row is TrackedWaybillOrder => row.npTtn !== null);
}

/** One row of the admin order list. */
export interface OrderListRow {
  orderNumber: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  paymentMethod: Order['paymentMethod'];
  deliveryMethod: Order['deliveryMethod'];
  total: Kopiykas;
  npTtn: string | null;
  itemCount: number;
  createdAt: Date;
}

export interface OrderListResult {
  rows: OrderListRow[];
  /** Matching rows in total, ignoring the page window. */
  total: number;
}

/**
 * The admin order list: newest first, optionally narrowed to one status and to
 * a search over the three things a manager has in front of them when they go
 * looking — the order number a customer read out, the customer's name, or their
 * phone.
 *
 * The phone match is on digits only, so `050 123` finds `+380501234567`
 * regardless of how either side was punctuated. Substring matching, like
 * `/search`, and for the same reason: the table is small and an operator types
 * fragments, not prefixes.
 */
/** Digits, and the punctuation a phone number is written with — nothing else. */
const PHONE_SHAPED = /^[\d\s+()-]+$/;
const MIN_PHONE_DIGITS = 3;

export async function listOrders(
  db: Db,
  options: { status?: OrderStatus; query?: string; limit: number; offset: number },
): Promise<OrderListResult> {
  const filters: SQL[] = [];

  if (options.status) filters.push(eq(orders.status, options.status));

  const query = options.query?.trim();
  if (query) {
    const text = likeContains(query);

    const matches: SQL[] = [
      sql`${orders.orderNumber} ilike ${text}`,
      sql`${orders.customerName} ilike ${text}`,
    ];

    // Only when the query is phone-shaped. Matching stray digits against phone
    // numbers is worse than useless: an order number like `B260804-DAMN7`
    // reduces to the digits `2608047`, and searching for `7` alone then returns
    // every customer whose number happens to contain one.
    const digits = PHONE_SHAPED.test(query) ? query.replace(/\D/g, '') : '';
    if (digits.length >= MIN_PHONE_DIGITS) {
      matches.push(
        sql`regexp_replace(${orders.customerPhone}, '\\D', '', 'g') like ${likeContains(digits)}`,
      );
    }

    const matched = or(...matches);
    if (matched) filters.push(matched);
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  // Join and group rather than a correlated subquery: inside a `select` field
  // Drizzle renders column references *unqualified* (`"order_id" = "id"`, not
  // `"order_items"."order_id" = "orders"."id"`), which in a subquery silently
  // resolves both sides to the inner table and counts nothing. It only
  // qualifies them in `where`/`orderBy` position. Grouping keeps every
  // reference bound to the schema, so a renamed column is a type error rather
  // than a wrong number on screen.
  const itemCount = sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        orderNumber: orders.orderNumber,
        status: orders.status,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        paymentMethod: orders.paymentMethod,
        deliveryMethod: orders.deliveryMethod,
        total: orders.total,
        npTtn: orders.npTtn,
        itemCount,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(where)
      .groupBy(orders.id)
      .orderBy(desc(orders.createdAt))
      .limit(options.limit)
      .offset(options.offset),

    db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);

  return { rows, total: counted?.total ?? 0 };
}

export interface PaymentWithOrder extends Payment {
  order: OrderWithItems;
}

/** The webhook's entry point: which order does this `invoiceId` belong to. */
export async function findPaymentByInvoiceId(
  db: Db | TxDb | Tx,
  invoiceId: string,
): Promise<PaymentWithOrder | null> {
  const payment = await db.query.payments.findFirst({
    where: (payments, { eq: eqCol }) => eqCol(payments.invoiceId, invoiceId),
    with: { order: { with: { items: true } } },
  });
  return payment ?? null;
}
