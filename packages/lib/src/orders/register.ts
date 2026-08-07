import { eq, inArray, sql } from 'drizzle-orm';
import type { TxDb } from '../db';
import type { Order } from '../db/schema';
import { npScanSheets, orders } from '../db/schema';

/**
 * The database half of the register of shipments (реєстр відправлень /
 * ScanSheet) — the batch document the seller hands over at the branch, NP-5 of
 * docs/plans/novaposhta.md. The carrier half lives in
 * `novaposhta/scanSheet.ts`; like the waybill, the page calls the carrier
 * first and this second, and compensates by deleting the carrier document if
 * the transaction here refuses.
 */

/**
 * May this order go onto a new register?
 *
 * `packed` only, on purpose: a register is composed *before* the handover, and
 * `packed` is precisely «waybill created, parcel not at the branch yet». A
 * `shipped` order is already scanned in and a register listing it would be a
 * document about the past. The waybill must be panel-made (`npTtnRef` — the
 * carrier call needs the document Ref, which a hand-entered number does not
 * have), and an order already on a register stays there — NP supports a
 * document being re-registered, the panel's one-register-per-batch model does
 * not.
 */
export function registerEligible(
  order: Pick<Order, 'status' | 'npTtnRef' | 'npScanSheetRef'>,
): boolean {
  return order.status === 'packed' && order.npTtnRef !== null && order.npScanSheetRef === null;
}

/** What the create page selected: the order, and the waybill it selected it with. */
export interface RegisterSelection {
  orderNumber: string;
  npTtnRef: string;
}

export type AttachRegisterResult =
  | { ok: true; count: number }
  /**
   * Between reading the selection and this transaction an order moved, lost
   * its waybill, got a *different* waybill (deleted and recreated — the
   * carrier document on the register would not be the order's), or joined
   * another register. All one answer: the register the carrier just made
   * describes a batch that no longer exists, and the caller deletes it.
   */
  | { ok: false; reason: 'orders_changed' };

export async function attachRegister(
  txDb: TxDb,
  sheet: { ref: string; number: string },
  selections: readonly RegisterSelection[],
): Promise<AttachRegisterResult> {
  return txDb.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(orders)
      .where(
        inArray(
          orders.orderNumber,
          selections.map((s) => s.orderNumber),
        ),
      )
      .for('update');

    const byNumber = new Map(rows.map((row) => [row.orderNumber, row]));
    const unchanged = selections.every((s) => {
      const row = byNumber.get(s.orderNumber);
      return row !== undefined && registerEligible(row) && row.npTtnRef === s.npTtnRef;
    });
    if (rows.length !== selections.length || !unchanged) {
      return { ok: false, reason: 'orders_changed' };
    }

    await tx.insert(npScanSheets).values({ ref: sheet.ref, number: sheet.number });
    await tx
      .update(orders)
      .set({ npScanSheetRef: sheet.ref, updatedAt: sql`now()` })
      .where(
        inArray(
          orders.id,
          rows.map((row) => row.id),
        ),
      );

    return { ok: true, count: rows.length };
  });
}

export type RemoveFromRegisterResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' }
  /** Already off it — a double submit, or the waybill was detached meanwhile. */
  | { ok: false; reason: 'not_on_register' };

/**
 * Takes one order off a register (the register itself survives, even empty —
 * deleting it is its own deliberate action). The `scanSheetRef` argument is
 * the page's word for *which* register it was looking at, checked against the
 * live row so a stale tab cannot pull an order off a register it re-joined.
 */
export async function removeFromRegister(
  txDb: TxDb,
  orderNumber: string,
  scanSheetRef: string,
): Promise<RemoveFromRegisterResult> {
  return txDb.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .for('update')
      .limit(1);

    if (!order) return { ok: false, reason: 'not_found' };
    if (order.npScanSheetRef !== scanSheetRef) return { ok: false, reason: 'not_on_register' };

    const [updated] = await tx
      .update(orders)
      .set({ npScanSheetRef: null, updatedAt: sql`now()` })
      .where(eq(orders.id, order.id))
      .returning();

    if (!updated) throw new Error('register remove returned no row');
    return { ok: true, order: updated };
  });
}

export type DeleteRegisterResult = { ok: true; detached: number } | { ok: false; reason: 'not_found' };

/**
 * Deletes the register's record and unlinks its orders. The orders and their
 * waybills are untouched beyond the link — deleting a register is undoing the
 * batching, not the parcels — which is also what the carrier's own
 * `deleteScanSheet` does to the waybills on its side.
 */
export async function deleteRegister(txDb: TxDb, ref: string): Promise<DeleteRegisterResult> {
  return txDb.transaction(async (tx) => {
    const deleted = await tx.delete(npScanSheets).where(eq(npScanSheets.ref, ref)).returning();
    if (deleted.length === 0) return { ok: false, reason: 'not_found' };

    const detached = await tx
      .update(orders)
      .set({ npScanSheetRef: null, updatedAt: sql`now()` })
      .where(eq(orders.npScanSheetRef, ref))
      .returning({ id: orders.id });

    return { ok: true, detached: detached.length };
  });
}
