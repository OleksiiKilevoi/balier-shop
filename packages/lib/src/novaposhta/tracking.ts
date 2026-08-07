import type { WaybillTracking } from '../ports';
import type { NovaPoshtaClient } from './client';

/**
 * Tracking over `TrackingDocument.getStatusDocuments`, and the status-code
 * table that NP-4's `applyCarrierStatus` will read.
 *
 * The table encodes one hard rule from the plan: **automation may only move an
 * order forward along `packed → shipped → delivered`; every unhappy code is an
 * alert and never a transition.** Automation that cancels an order on a
 * carrier code will eventually cancel a paid one.
 */

/* ----------------------------------------------------------------- tracking */

/** getStatusDocuments takes at most this many documents per call. */
const TRACKING_BATCH = 100;

interface RawTrackedDocument {
  Number: string;
  StatusCode: string;
  Status: string;
}

/**
 * Any number of waybill numbers; the batching is this function's whole reason
 * to exist. `Phone` is sent empty — with it NP reveals more fields, but
 * nothing the sync reads, and the phone would have to be looked up per order.
 */
export async function trackWaybills(
  client: NovaPoshtaClient,
  numbers: readonly string[],
): Promise<WaybillTracking[]> {
  const results: WaybillTracking[] = [];

  for (let start = 0; start < numbers.length; start += TRACKING_BATCH) {
    const batch = numbers.slice(start, start + TRACKING_BATCH);
    const rows = await client.call<RawTrackedDocument>({
      modelName: 'TrackingDocument',
      calledMethod: 'getStatusDocuments',
      methodProperties: {
        Documents: batch.map((number) => ({ DocumentNumber: number, Phone: '' })),
      },
    });

    for (const row of rows) {
      results.push({
        number: row.Number,
        statusCode: String(row.StatusCode),
        statusText: row.Status,
      });
    }
  }

  return results;
}

/* --------------------------------------------------------- the status table */

/** The alerts NP-4 sends to Telegram. None of them moves an order. */
export type CarrierAlert =
  | 'not_found' // 3 — a mistyped or deleted waybill number
  | 'refused' // 102, 103, 108 — somebody declined the parcel
  | 'storage_ended' // 105 — the branch stopped holding it
  | 'returning' // 106 — a return waybill now exists
  | 'failed_delivery'; // 111 — delivery attempted, recipient absent

export interface CarrierStatusIntent {
  /**
   * The order status this code testifies to, or null when the code moves
   * nothing. `packed` never appears: code 1 (created, not handed over) means
   * the order simply *stays* `packed`, and staying is not a move.
   */
  move: 'shipped' | 'delivered' | null;
  /** Code 11 — the COD money transfer credited. Recorded, moves nothing extra. */
  moneyTransfer: boolean;
  alert: CarrierAlert | null;
  /** False for a code this table has never seen — NP-4 logs those and moves nothing. */
  known: boolean;
}

/**
 * Intent per the plan's table, plus three codes found while writing this that
 * the plan missed (41, 14, 108 — noted back into the plan file). Worth restating
 * from the plan: **verify against the live API before relying on it** — the
 * table is the intent, live driving in NP-4 is the confirmation.
 *
 *   1              created, parcel not handed over          stays `packed`
 *   2              deleted                                   nothing
 *   3              number not found                          alert
 *   4, 41, 5, 6,   in transit / arrived / with recipient     `shipped`
 *   7, 8, 12, 14,    for inspection (14 is NOT received)
 *   101, 104, 112
 *   9, 10          received                                  `delivered`
 *   11             received + money transfer credited        `delivered` + stamp
 *   102, 103, 108  refusal                                   alert
 *   105            storage ended                             alert
 *   106            return waybill created                    alert
 *   111            failed delivery attempt                   alert
 */
const SHIPPED = new Set(['4', '41', '5', '6', '7', '8', '12', '14', '101', '104', '112']);
const DELIVERED = new Set(['9', '10', '11']);

const ALERTS: Record<string, CarrierAlert> = {
  '3': 'not_found',
  '102': 'refused',
  '103': 'refused',
  '108': 'refused',
  '105': 'storage_ended',
  '106': 'returning',
  '111': 'failed_delivery',
};

const QUIET = new Set(['1', '2']);

export function carrierStatusIntent(statusCode: string): CarrierStatusIntent {
  const code = statusCode.trim();

  if (SHIPPED.has(code)) return { move: 'shipped', moneyTransfer: false, alert: null, known: true };
  if (DELIVERED.has(code)) {
    return { move: 'delivered', moneyTransfer: code === '11', alert: null, known: true };
  }
  const alert = ALERTS[code];
  if (alert) return { move: null, moneyTransfer: false, alert, known: true };
  if (QUIET.has(code)) return { move: null, moneyTransfer: false, alert: null, known: true };

  return { move: null, moneyTransfer: false, alert: null, known: false };
}
