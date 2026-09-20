import { and, desc, or, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { orders, promoCodes } from '../schema';
import { likeContains } from './like';

/**
 * «Клієнти» in the panel. There is no customers table: a customer is a phone
 * number seen on orders, folded together here, plus the addresses that asked
 * the storefront popup for a promo code and never ordered. Read-only — the
 * facts live on the orders and the promo rows, this only groups them.
 *
 * Money and counts skip `cancelled` orders: an abandoned card payment is not
 * a purchase. The name and e-mail shown are the most recent ones the person
 * typed, since people fix typos on their second order, not their first.
 */
export interface CustomerRow {
  phone: string;
  name: string;
  email: string | null;
  /** Live orders (not cancelled). */
  orderCount: number;
  /** Kopiykas, sum of live orders' totals. */
  revenue: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  lastOrderNumber: string;
  /** The promo code issued to this person's e-mail, when they have one. */
  promoCode: string | null;
}

export interface PromoSubscriberRow {
  email: string;
  code: string;
  percent: number;
  createdAt: Date;
  /** Bound to a live order. */
  used: boolean;
}

/** Digits-only LIKE for a phone-shaped query, same rule as the order list. */
const PHONE_SHAPED = /^[\d\s()+-]+$/;

export async function listCustomers(
  db: Db,
  options: { query?: string; limit: number; offset: number },
): Promise<{ rows: CustomerRow[]; total: number }> {
  const filters = [sql`${orders.status} <> 'cancelled'`];
  const query = options.query?.trim();
  if (query) {
    const text = likeContains(query);
    const digits = PHONE_SHAPED.test(query) ? query.replace(/\D/g, '') : '';
    const match = [
      sql`${orders.customerName} ilike ${text}`,
      sql`${orders.customerEmail} ilike ${text}`,
      ...(digits ? [sql`${orders.customerPhone} like ${likeContains(digits)}`] : []),
    ];
    filters.push(or(...match)!);
  }
  const where = and(...filters);

  // One row per phone. `array_agg(... order by created_at desc)[1]` picks the
  // newest name/e-mail/order number without a second query.
  const grouped = db
    .select({
      phone: orders.customerPhone,
      name: sql<string>`(array_agg(${orders.customerName} order by ${orders.createdAt} desc))[1]`.as('name'),
      email: sql<string | null>`(array_agg(${orders.customerEmail} order by ${orders.createdAt} desc) filter (where ${orders.customerEmail} is not null))[1]`.as('email'),
      orderCount: sql<number>`count(*)::int`.as('order_count'),
      revenue: sql<number>`sum(${orders.total})::int`.as('revenue'),
      firstOrderAt: sql<Date>`min(${orders.createdAt})`.as('first_order_at'),
      lastOrderAt: sql<Date>`max(${orders.createdAt})`.as('last_order_at'),
      lastOrderNumber: sql<string>`(array_agg(${orders.orderNumber} order by ${orders.createdAt} desc))[1]`.as('last_order_number'),
    })
    .from(orders)
    .where(where)
    .groupBy(orders.customerPhone)
    .as('c');

  const [rows, [count]] = await Promise.all([
    db
      .select({
        phone: grouped.phone,
        name: grouped.name,
        email: grouped.email,
        orderCount: grouped.orderCount,
        revenue: grouped.revenue,
        firstOrderAt: grouped.firstOrderAt,
        lastOrderAt: grouped.lastOrderAt,
        lastOrderNumber: grouped.lastOrderNumber,
        // A correlated lookup rather than a join: both sides have an `email`
        // column and the subquery's fields come out unqualified.
        promoCode: sql<string | null>`(select p.code from promo_codes p where p.email = lower(c.email) limit 1)`,
      })
      .from(grouped)
      .orderBy(desc(grouped.lastOrderAt))
      .limit(options.limit)
      .offset(options.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(grouped),
  ]);

  return {
    rows: rows.map((row) => ({
      ...row,
      firstOrderAt: new Date(row.firstOrderAt),
      lastOrderAt: new Date(row.lastOrderAt),
    })),
    total: count?.total ?? 0,
  };
}

/** Everyone who asked for a code, newest first — the mailing list the popup builds. */
export async function listPromoSubscribers(
  db: Db,
  options: { limit: number },
): Promise<PromoSubscriberRow[]> {
  return db
    .select({
      email: promoCodes.email,
      code: promoCodes.code,
      percent: promoCodes.percent,
      createdAt: promoCodes.createdAt,
      used: sql<boolean>`${orders.id} is not null`,
    })
    .from(promoCodes)
    .leftJoin(orders, and(sql`${orders.id} = ${promoCodes.orderId}`, sql`${orders.status} <> 'cancelled'`))
    .orderBy(desc(promoCodes.createdAt))
    .limit(options.limit);
}
