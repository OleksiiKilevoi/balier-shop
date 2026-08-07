import { eq, sql } from 'drizzle-orm';
import type { TxDb } from '../db';
import type { Order } from '../db/schema';
import { orders } from '../db/schema';
import { revertTarget } from './status';

/**
 * The database half of waybill creation and deletion. The carrier half lives
 * in `novaposhta/waybill.ts`; the page calls the carrier first and this
 * second, because a row is cheap to undo and a carrier document is not — if
 * the transaction here refuses after the document was created, the page
 * compensates by deleting the document, not the other way round.
 *
 * `packed` is set by the fact of attaching a waybill and undone by detaching
 * it — there is no button for it (docs/plans/novaposhta.md): creating the
 * waybill *is* the act of packing the order.
 */

export type AttachWaybillResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' }
  /** A double submit, or a second operator — the second parcel must not exist. */
  | { ok: false; reason: 'ttn_exists'; order: Order }
  /** Not `paid`/`confirmed` any more — the order moved while the form was open. */
  | { ok: false; reason: 'waybill_invalid_state'; order: Order };

export async function attachWaybill(
  txDb: TxDb,
  orderNumber: string,
  waybill: { ttn: string; ttnRef: string },
): Promise<AttachWaybillResult> {
  return txDb.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .for('update')
      .limit(1);

    if (!order) return { ok: false, reason: 'not_found' };
    if (order.npTtn !== null) return { ok: false, reason: 'ttn_exists', order };
    /*
     * The one place `packed` is produced (`docs/plans/novaposhta.md`: creating
     * the waybill *is* the act of packing), so the rule lives here rather than
     * in `allowedTransitions`, which since NP-4 offers the panel no forward
     * moves at all. Only the two statuses whose forward step is `packed`
     * qualify — a waybill must never be attached to an order that is already
     * on a courier's shelf.
     */
    if (order.status !== 'paid' && order.status !== 'confirmed') {
      return { ok: false, reason: 'waybill_invalid_state', order };
    }

    const [updated] = await tx
      .update(orders)
      .set({
        status: 'packed',
        npTtn: waybill.ttn,
        npTtnRef: waybill.ttnRef,
        npTtnCreatedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(orders.id, order.id))
      .returning();

    if (!updated) throw new Error('waybill attach returned no row');
    return { ok: true, order: updated };
  });
}

export type DetachWaybillResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'no_waybill'; order: Order };

/**
 * The columns a detach writes, shared with `applyCarrierStatus` — the cron's
 * reaction to carrier code 2 (deleted in the NP cabinet) must clear exactly
 * what «Видалити ТТН» clears, and a column added to one path but not the
 * other would leave tracking noise describing a document that no longer
 * exists. Reverts `packed` by the same rule the revert button used to; any
 * other status keeps its status and only loses the waybill.
 */
export function waybillDetachPatch(order: Order) {
  return {
    status: order.status === 'packed' ? (revertTarget(order) ?? order.status) : order.status,
    npTtn: null,
    npTtnRef: null,
    npTtnCreatedAt: null,
    npStatusCode: null,
    npStatusText: null,
    npStatusAt: null,
    npMoneyTransferAt: null,
    npScanSheetRef: null,
    updatedAt: sql`now()`,
  };
}

/**
 * Clears everything the waybill wrote, including the tracking columns NP-4
 * fills — status text about a document that no longer exists is noise that
 * reads as fact. Reverts `packed` by the same rule the revert button uses;
 * any other status (say the order was cancelled first and the operator is
 * tidying up the waybill after) keeps its status and only loses the waybill.
 */
export async function detachWaybill(
  txDb: TxDb,
  orderNumber: string,
): Promise<DetachWaybillResult> {
  return txDb.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .for('update')
      .limit(1);

    if (!order) return { ok: false, reason: 'not_found' };
    if (order.npTtn === null) return { ok: false, reason: 'no_waybill', order };

    const [updated] = await tx
      .update(orders)
      .set(waybillDetachPatch(order))
      .where(eq(orders.id, order.id))
      .returning();

    if (!updated) throw new Error('waybill detach returned no row');
    return { ok: true, order: updated };
  });
}
