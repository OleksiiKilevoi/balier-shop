import { describe, expect, it, vi } from 'vitest';
import type { NovaPoshtaClient } from './client';
import { carrierStatusIntent, trackWaybills } from './tracking';

describe('trackWaybills', () => {
  it('batches by 100 and concatenates the results', async () => {
    const call = vi.fn(async (request: { methodProperties: { Documents: unknown[] } }) =>
      request.methodProperties.Documents.map((doc) => ({
        Number: (doc as { DocumentNumber: string }).DocumentNumber,
        StatusCode: 9,
        Status: 'Відправлення отримано',
      })),
    );
    const client = { call } as unknown as NovaPoshtaClient;

    const numbers = Array.from({ length: 250 }, (_, i) => String(20450000000000 + i));
    const tracked = await trackWaybills(client, numbers);

    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[0]![0].methodProperties.Documents).toHaveLength(100);
    expect(call.mock.calls[2]![0].methodProperties.Documents).toHaveLength(50);
    expect(tracked).toHaveLength(250);
    expect(tracked[0]!.number).toBe('20450000000000');
    // NP is stringly typed but not reliably so — the code is normalised.
    expect(tracked[0]!.statusCode).toBe('9');
  });
});

/**
 * The rule the whole table lives under: automation only ever moves
 * `packed → shipped → delivered`. An alert code must never carry a move —
 * asserted as a property over the table, not per code, so a future edit
 * cannot quietly break it.
 */
/** Every code the table knows, for the property tests below. */
const ALL_KNOWN_CODES = [
  '1', '2', '3',
  '4', '41', '5', '6', '7', '8', '12', '14', '101', '104', '112',
  '9', '10', '11',
  '102', '103', '105', '106', '108', '111',
];

describe('carrierStatusIntent', () => {
  it('keeps a created-but-not-handed-over parcel where it is', () => {
    expect(carrierStatusIntent('1')).toEqual({
      move: null,
      detach: false,
      moneyTransfer: false,
      alert: null,
      known: true,
    });
  });

  it('maps the in-transit family to shipped', () => {
    for (const code of ['4', '41', '5', '6', '12', '101', '104', '112']) {
      expect(carrierStatusIntent(code).move, code).toBe('shipped');
    }
  });

  it('maps branch/locker arrival to arrived — «Доставлено», not yet «Отримано»', () => {
    for (const code of ['7', '8']) {
      expect(carrierStatusIntent(code).move, code).toBe('arrived');
    }
  });

  it('treats inspection (14) as arrived, never delivered', () => {
    // The recipient is holding the parcel at the branch but has not accepted
    // it — money has not changed hands, so `delivered` (which for COD *means*
    // money) is wrong.
    expect(carrierStatusIntent('14').move).toBe('arrived');
  });

  it('maps receipt to delivered, and code 11 additionally stamps the transfer', () => {
    expect(carrierStatusIntent('9')).toEqual({
      move: 'delivered',
      detach: false,
      moneyTransfer: false,
      alert: null,
      known: true,
    });
    expect(carrierStatusIntent('10').move).toBe('delivered');
    expect(carrierStatusIntent('11')).toEqual({
      move: 'delivered',
      detach: false,
      moneyTransfer: true,
      alert: null,
      known: true,
    });
  });

  it('turns every unhappy code into an alert and never a move', () => {
    expect(carrierStatusIntent('3').alert).toBe('not_found');
    expect(carrierStatusIntent('102').alert).toBe('refused');
    expect(carrierStatusIntent('103').alert).toBe('refused');
    expect(carrierStatusIntent('108').alert).toBe('refused');
    expect(carrierStatusIntent('105').alert).toBe('storage_ended');
    expect(carrierStatusIntent('106').alert).toBe('returning');
    expect(carrierStatusIntent('111').alert).toBe('failed_delivery');

    // The property, over the whole table rather than a hand-kept list: any
    // code that alerts moves nothing — automation that moves an order on an
    // unhappy code will eventually cancel a paid one.
    for (const code of ALL_KNOWN_CODES) {
      const intent = carrierStatusIntent(code);
      if (intent.alert !== null) expect(intent.move, code).toBeNull();
    }
  });

  it('detaches silently on deletion (2) — a cabinet-deleted waybill must not outlive its document', () => {
    // Panel deletions clear our record before the sync could ever see code 2,
    // so seeing it means someone deleted the waybill in the NP cabinet — the
    // dead end found live on 2026-08-07, recorded in the plan's NP-4 table.
    // No alert: the panel page showing the reverted order is notice enough.
    expect(carrierStatusIntent('2')).toEqual({
      move: null,
      detach: true,
      moneyTransfer: false,
      alert: null,
      known: true,
    });
  });

  it('never combines a detach with a move — over every code, not per case', () => {
    for (const code of ALL_KNOWN_CODES) {
      const intent = carrierStatusIntent(code);
      if (intent.detach) expect(intent.move, code).toBeNull();
    }
  });

  it('confesses to codes it has never seen instead of guessing', () => {
    const unknown = carrierStatusIntent('999');
    expect(unknown).toEqual({
      move: null,
      detach: false,
      moneyTransfer: false,
      alert: null,
      known: false,
    });
  });
});
