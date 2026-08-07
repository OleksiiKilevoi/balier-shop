import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '../db/schema';
import { decideCarrierStatus } from './applyCarrierStatus';

/**
 * The pure half of NP-4: what one tracking answer means for one order. The
 * transactional wrapper around it is thin plumbing (`FOR UPDATE`, one UPDATE)
 * and is driven live instead; what is worth locking down here is the decision
 * — moves only ever forward, alerts only on a fresh code, columns only
 * written when they would change.
 */

function order(
  status: OrderStatus,
  npStatusCode: string | null = null,
  npMoneyTransferAt: Date | null = null,
) {
  return { status, npStatusCode, npMoneyTransferAt };
}

const tracked = (statusCode: string, statusText = 'статус') => ({ statusCode, statusText });

describe('decideCarrierStatus', () => {
  it('moves a packed order to shipped on an in-transit code, recording it', () => {
    expect(decideCarrierStatus(order('packed'), tracked('4'))).toEqual({
      move: 'shipped',
      detach: false,
      stampMoneyTransfer: false,
      recordStatus: true,
      alert: null,
      known: true,
    });
  });

  it('moves shipped to arrived on branch arrival, and on to delivered on receipt', () => {
    expect(decideCarrierStatus(order('shipped', '4'), tracked('7')).move).toBe('arrived');
    expect(decideCarrierStatus(order('arrived', '7'), tracked('9')).move).toBe('delivered');
    // A 15-minute tick that never saw the intermediate codes — the handover is
    // better evidence of `delivered` than our having witnessed every hop.
    expect(decideCarrierStatus(order('packed'), tracked('9')).move).toBe('delivered');
    expect(decideCarrierStatus(order('packed'), tracked('7')).move).toBe('arrived');
  });

  it('never moves backward — a late in-transit code after delivery changes nothing but the record', () => {
    const decision = decideCarrierStatus(order('delivered', '9'), tracked('4'));
    expect(decision.move).toBeNull();
    expect(decision.recordStatus).toBe(true);
  });

  it('stamps the money transfer exactly once', () => {
    expect(decideCarrierStatus(order('delivered', '9'), tracked('11')).stampMoneyTransfer).toBe(
      true,
    );
    const stamped = order('delivered', '11', new Date('2026-08-07'));
    expect(decideCarrierStatus(stamped, tracked('11')).stampMoneyTransfer).toBe(false);
  });

  it('alerts only on a fresh code — a 15-minute cron must not page 96 times a day', () => {
    expect(decideCarrierStatus(order('shipped', '4'), tracked('102')).alert).toBe('refused');
    expect(decideCarrierStatus(order('shipped', '102'), tracked('102')).alert).toBeNull();
  });

  it('detaches on code 2 — a cabinet-deleted waybill must not outlive its document', () => {
    const decision = decideCarrierStatus(order('packed', '1'), tracked('2'));
    expect(decision.detach).toBe(true);
    expect(decision.alert).toBeNull();
    expect(decision.move).toBeNull();
    // The detach clears the status columns; writing them too would be absurd.
    expect(decision.recordStatus).toBe(false);
  });

  it('records an unchanged code as nothing at all — no tuple churn', () => {
    // The 2026-08-06 lesson: a row rewritten every tick with the same values
    // is retained history Postgres has to keep.
    const decision = decideCarrierStatus(order('shipped', '4'), tracked('4'));
    expect(decision).toEqual({
      move: null,
      detach: false,
      stampMoneyTransfer: false,
      recordStatus: false,
      alert: null,
      known: true,
    });
  });

  it('confesses to an unknown code and moves nothing', () => {
    const decision = decideCarrierStatus(order('packed'), tracked('999'));
    expect(decision.known).toBe(false);
    expect(decision.move).toBeNull();
    expect(decision.detach).toBe(false);
    // Still recorded: the row should show what the carrier actually said.
    expect(decision.recordStatus).toBe(true);
  });
});
