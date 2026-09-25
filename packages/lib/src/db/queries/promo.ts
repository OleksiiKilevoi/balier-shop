import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../index';
import type { PromoCode } from '../schema';
import { orders, promoCodes } from '../schema';
import { generatePromoCode } from '../../orders/promo';

/**
 * Issue (or re-issue) the code for an e-mail. The address is the identity: a
 * second request returns the row the first one made, at the percentage it was
 * promised then — so «one per person» holds and the e-mail can simply be sent
 * again. A generated code colliding on its unique column is astronomically
 * unlikely; when it happens the insert throws and the popup asks to retry.
 */
export async function issuePromoCode(db: Db, email: string, percent: number): Promise<PromoCode> {
  const normalized = email.trim().toLowerCase();
  const [row] = await db
    .insert(promoCodes)
    .values({ email: normalized, code: generatePromoCode(), percent })
    // A no-op update, so `returning` yields the existing row instead of nothing.
    .onConflictDoUpdate({ target: promoCodes.email, set: { email: normalized } })
    .returning();
  if (!row) throw new Error('promo code upsert returned no row');
  return row;
}

/**
 * The row behind a code the checkout was handed, if it can still be redeemed:
 * never used, or used by an order that was since cancelled (an abandoned card
 * payment must not burn the discount). Locked for the transaction so two
 * simultaneous checkouts cannot both spend it.
 */
export async function findUsablePromoCode(tx: Tx, code: string): Promise<PromoCode | null> {
  const [row] = await tx
    .select({ promo: promoCodes })
    .from(promoCodes)
    .leftJoin(orders, eq(orders.id, promoCodes.orderId))
    .where(
      and(
        eq(promoCodes.code, code),
        sql`(${promoCodes.orderId} IS NULL OR ${orders.status} = 'cancelled')`,
      ),
    )
    .for('update', { of: promoCodes })
    .limit(1);
  return row?.promo ?? null;
}

/** Whether the code exists at all — separates «no such code» from «already used». */
export async function promoCodeExists(tx: Tx, code: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: promoCodes.id })
    .from(promoCodes)
    .where(eq(promoCodes.code, code))
    .limit(1);
  return row !== undefined;
}

/**
 * Whether this phone or e-mail already has an order that wasn't cancelled —
 * what a first-order-only code checks.
 * ponytail: a new phone and no e-mail passes; a real identity is the upgrade path.
 */
export async function hasPriorOrder(tx: Tx, phone: string, email: string | undefined): Promise<boolean> {
  const [row] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        ne(orders.status, 'cancelled'),
        email
          ? or(eq(orders.customerPhone, phone), sql`lower(${orders.customerEmail}) = ${email}`)
          : eq(orders.customerPhone, phone),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function bindPromoCode(tx: Tx, promoId: string, orderId: string): Promise<void> {
  await tx.update(promoCodes).set({ orderId }).where(eq(promoCodes.id, promoId));
}

/** For the settings screen: how many codes went out, how many bought something. */
export async function countPromoCodes(db: Db): Promise<{ issued: number; used: number }> {
  const [row] = await db
    .select({
      issued: sql<number>`count(*)::int`,
      used: sql<number>`count(*) filter (where ${orders.id} is not null)::int`,
    })
    .from(promoCodes)
    .leftJoin(orders, and(eq(orders.id, promoCodes.orderId), ne(orders.status, 'cancelled')));
  return { issued: row?.issued ?? 0, used: row?.used ?? 0 };
}
