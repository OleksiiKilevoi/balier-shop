import { eq, sql } from 'drizzle-orm';
import type { TxDb } from '../db';
import type { Order } from '../db/schema';
import { orders } from '../db/schema';
import { carrierStatusIntent } from '../novaposhta/tracking';
import type { CarrierAlert } from '../novaposhta/tracking';
import { carrierCanAdvance } from './status';
import { waybillDetachPatch } from './waybill';

/**
 * NP-4's write path: what one tracking answer does to one order.
 *
 * The *meaning* of a carrier code lives in `novaposhta/tracking.ts`
 * (`carrierStatusIntent`); the *rule* about which statuses tracking may move
 * lives in `./status.ts` (`carrierCanAdvance`). This file only composes the
 * two into a decision (`decideCarrierStatus`, pure and tested) and applies it
 * under the same `FOR UPDATE` every other order write takes — a waybill
 * deleted from the panel between the cron's list query and this write must
 * win, which is what the `waybill_changed` refusal is.
 */

export interface CarrierDecision {
  /** The forward move tracking testifies to, already checked against the chain. */
  move: 'shipped' | 'delivered' | null;
  /** Code 2 — clear the waybill columns and revert `packed`, like «Видалити ТТН». */
  detach: boolean;
  /** Code 11 seen for the first time — stamp `npMoneyTransferAt`. */
  stampMoneyTransfer: boolean;
  /** The code is new to this order — write the three `np_status_*` columns. */
  recordStatus: boolean;
  /**
   * The Telegram alert this code earns, only when the code is *fresh* — the
   * cron runs every 15 minutes and an unchanged unhappy code must not page
   * the manager 96 times a day.
   */
  alert: CarrierAlert | null;
  /** False for a code the table has never seen — log it, move nothing. */
  known: boolean;
}

export function decideCarrierStatus(
  order: Pick<Order, 'status' | 'npStatusCode' | 'npMoneyTransferAt'>,
  tracked: { statusCode: string; statusText: string },
): CarrierDecision {
  const intent = carrierStatusIntent(tracked.statusCode);
  const fresh = order.npStatusCode !== tracked.statusCode;

  return {
    move:
      intent.move !== null && carrierCanAdvance(order.status, intent.move) ? intent.move : null,
    detach: intent.detach,
    stampMoneyTransfer: intent.moneyTransfer && order.npMoneyTransferAt === null,
    /* Written only when the code changed — the sync-bloat lesson of
       2026-08-06: a row rewritten every 15 minutes with the same values is
       pure tuple churn. A detach clears these columns instead of writing them. */
    recordStatus: fresh && !intent.detach,
    alert: fresh ? intent.alert : null,
    known: intent.known,
  };
}

export type ApplyCarrierStatusResult =
  | { ok: true; order: Order; decision: CarrierDecision; changed: boolean }
  | { ok: false; reason: 'not_found' }
  /** The order's waybill is no longer the one that was tracked — skip, silently. */
  | { ok: false; reason: 'waybill_changed' };

export async function applyCarrierStatus(
  txDb: TxDb,
  orderNumber: string,
  tracked: { number: string; statusCode: string; statusText: string },
): Promise<ApplyCarrierStatusResult> {
  return txDb.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .for('update')
      .limit(1);

    if (!order) return { ok: false, reason: 'not_found' };
    if (order.npTtn !== tracked.number) return { ok: false, reason: 'waybill_changed' };

    const decision = decideCarrierStatus(order, tracked);

    if (decision.detach) {
      const [updated] = await tx
        .update(orders)
        .set(waybillDetachPatch(order))
        .where(eq(orders.id, order.id))
        .returning();
      if (!updated) throw new Error('carrier detach returned no row');
      return { ok: true, order: updated, decision, changed: true };
    }

    const changed =
      decision.move !== null || decision.stampMoneyTransfer || decision.recordStatus;
    if (!changed) return { ok: true, order, decision, changed: false };

    const [updated] = await tx
      .update(orders)
      .set({
        ...(decision.move !== null ? { status: decision.move } : {}),
        ...(decision.recordStatus
          ? {
              npStatusCode: tracked.statusCode,
              npStatusText: tracked.statusText,
              npStatusAt: sql`now()`,
            }
          : {}),
        ...(decision.stampMoneyTransfer ? { npMoneyTransferAt: sql`now()` } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(orders.id, order.id))
      .returning();

    if (!updated) throw new Error('carrier status update returned no row');
    return { ok: true, order: updated, decision, changed: true };
  });
}
