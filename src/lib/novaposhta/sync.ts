import { sql } from 'drizzle-orm';
import type { Db } from '~/lib/db';
import { npSettlements, npWarehouses } from '~/lib/db/schema';
import type { NovaPoshtaClient } from './client';

/**
 * Full-country settlement + warehouse sync, run by the daily cron
 * (`workers/cron/index.ts`) and by `scripts/sync-novaposhta.ts` for the
 * initial/manual population. `/checkout` never calls Nova Poshta directly —
 * it reads whatever this last wrote into `np_settlements`/`np_warehouses`.
 *
 * Each page is upserted as soon as it arrives, not accumulated and written
 * at the end: a sync that fails partway through (a real risk — NP rate-
 * limits a plain back-to-back pagination loop, confirmed live while building
 * this: the ~180-page settlement sync completed, the warehouse one didn't)
 * still leaves the earlier pages refreshed. Nothing here writes stock or
 * order status, so the "same transaction" rule in `docs/CONVENTIONS.md`
 * doesn't apply — this is reference data, not money.
 */

interface RawSettlement {
  Ref: string;
  Description: string;
  AreaDescription?: string;
  RegionsDescription?: string;
  /** Ukrainian settlement-type label — "місто" | "село" | "селище" | "селище міського типу". */
  SettlementTypeDescription?: string;
  DeliveryCity?: string;
}

interface RawWarehouseType {
  Ref: string;
  Description: string;
}

interface RawWarehouse {
  Ref: string;
  Description: string;
  Number?: string;
  SettlementRef?: string;
  CityRef?: string;
  TypeOfWarehouse?: string;
  TotalMaxWeightAllowed?: string;
  Longitude?: string;
  Latitude?: string;
}

const SETTLEMENTS_PAGE_SIZE = 150;
const WAREHOUSES_PAGE_SIZE = 500;
// A safety valve against an API that never returns a short final page —
// not a real expectation for either dataset's size.
const MAX_PAGES = 2000;

// NP's rate limit isn't documented anywhere findable. 300ms/5-retry was the
// first guess and it wasn't enough — live-tested twice: settlements (~180
// pages) never got throttled, but getWarehouses hit a wall it couldn't climb
// out of within 5 backoff attempts, first at page 1, then again around page 7
// after some real recovery time had passed between runs. That shape (partial
// recovery over minutes, not seconds) is why the delay and backoff ceiling
// below are generous rather than tuned tight — a slow, reliable sync beats a
// fast, fragile one for a job that only needs to run once a day.
const REQUEST_DELAY_MS = 1500;
const MAX_RATE_LIMIT_RETRIES = 8;
const BASE_BACKOFF_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(err: unknown): boolean {
  return err instanceof Error && /too many requests/i.test(err.message);
}

/**
 * Pages through `fetchPage`, upserting each page via `upsertPage` as soon as
 * it arrives. Retries a rate-limited page with exponential backoff instead
 * of aborting the whole sync over one throttled request.
 */
async function paginateAndUpsert<T>(
  fetchPage: (page: number) => Promise<T[]>,
  pageSize: number,
  upsertPage: (rows: T[]) => Promise<void>,
): Promise<number> {
  let total = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let rows: T[] | undefined;

    for (let attempt = 0; ; attempt++) {
      try {
        rows = await fetchPage(page);
        break;
      } catch (err) {
        if (attempt >= MAX_RATE_LIMIT_RETRIES || !isRateLimited(err)) throw err;
        const delay = BASE_BACKOFF_MS * 2 ** attempt;
        console.warn(`Nova Poshta rate-limited on page ${page}, retrying in ${delay}ms`);
        await sleep(delay);
      }
    }

    if (rows.length > 0) {
      await upsertPage(rows);
      total += rows.length;
    }

    if (rows.length < pageSize) break;
    await sleep(REQUEST_DELAY_MS);
  }

  return total;
}

async function upsertSettlements(db: Db, rows: RawSettlement[]): Promise<void> {
  await db
    .insert(npSettlements)
    .values(
      rows.map((s) => ({
        ref: s.Ref,
        name: s.Description,
        area: s.AreaDescription ?? null,
        region: s.RegionsDescription ?? null,
        type: s.SettlementTypeDescription ?? null,
        deliveryCityRef: s.DeliveryCity ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: npSettlements.ref,
      set: {
        name: sql`excluded.name`,
        area: sql`excluded.area`,
        region: sql`excluded.region`,
        type: sql`excluded.type`,
        deliveryCityRef: sql`excluded.delivery_city_ref`,
        updatedAt: sql`now()`,
      },
    });
}

async function syncSettlements(client: NovaPoshtaClient, db: Db): Promise<number> {
  return paginateAndUpsert<RawSettlement>(
    (page) =>
      client.call<RawSettlement>({
        modelName: 'AddressGeneral',
        calledMethod: 'getSettlements',
        methodProperties: { Page: String(page), Limit: String(SETTLEMENTS_PAGE_SIZE) },
      }),
    SETTLEMENTS_PAGE_SIZE,
    (rows) => upsertSettlements(db, rows),
  );
}

/**
 * `TypeOfWarehouse` on a warehouse row is a reference-book GUID; resolving it
 * to its Ukrainian description here (via NP's own `getWarehouseTypes`, live-
 * verified against the real API while building this: it returns 5 rows,
 * including both `Поштомат` and `Поштомат ПриватБанку`) means
 * `np_warehouses.type_ref` ends up holding a human-readable label
 * (`Поштове(ий)`, `Поштомат`, …) instead of an opaque ref — which is what
 * `src/lib/db/queries/novaposhta.ts` filters on to tell a `np_warehouse`
 * pickup from a `np_postomat` one, without this codebase ever having to
 * hardcode a NP type-ref constant it couldn't independently verify.
 */
async function syncWarehouses(client: NovaPoshtaClient, db: Db): Promise<number> {
  const warehouseTypes = await client.call<RawWarehouseType>({
    modelName: 'AddressGeneral',
    calledMethod: 'getWarehouseTypes',
  });
  const typeNameByRef = new Map(warehouseTypes.map((t) => [t.Ref, t.Description]));

  const upsertWarehouses = (rows: RawWarehouse[]) =>
    db
      .insert(npWarehouses)
      .values(
        rows
          .filter((w) => w.SettlementRef ?? w.CityRef)
          .map((w) => ({
            ref: w.Ref,
            settlementRef: (w.SettlementRef ?? w.CityRef)!,
            number: w.Number ?? null,
            description: w.Description,
            typeRef: w.TypeOfWarehouse ? (typeNameByRef.get(w.TypeOfWarehouse) ?? null) : null,
            maxWeightKg: w.TotalMaxWeightAllowed
              ? Math.trunc(Number(w.TotalMaxWeightAllowed)) || null
              : null,
            latitude: w.Latitude ?? null,
            longitude: w.Longitude ?? null,
            isActive: true,
          })),
      )
      .onConflictDoUpdate({
        target: npWarehouses.ref,
        set: {
          settlementRef: sql`excluded.settlement_ref`,
          number: sql`excluded.number`,
          description: sql`excluded.description`,
          typeRef: sql`excluded.type_ref`,
          maxWeightKg: sql`excluded.max_weight_kg`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          isActive: sql`excluded.is_active`,
          updatedAt: sql`now()`,
        },
      })
      .then(() => undefined);

  return paginateAndUpsert<RawWarehouse>(
    (page) =>
      client.call<RawWarehouse>({
        modelName: 'AddressGeneral',
        calledMethod: 'getWarehouses',
        methodProperties: { Page: String(page), Limit: String(WAREHOUSES_PAGE_SIZE) },
      }),
    WAREHOUSES_PAGE_SIZE,
    upsertWarehouses,
  );
}

/**
 * `np_settlements.warehouse_count` has no independent source data — it's
 * derived from `np_warehouses` itself, so it can only be correct once that
 * table's sync has finished. A single correlated UPDATE over ~27k rows is
 * cheap next to the minutes-long paginated sync it follows.
 */
async function refreshSettlementWarehouseCounts(db: Db): Promise<void> {
  await db.execute(sql`
    update ${npSettlements}
    set warehouse_count = coalesce(
      (select count(*) from ${npWarehouses}
       where ${npWarehouses.settlementRef} = ${npSettlements.ref} and ${npWarehouses.isActive}),
      0
    )
  `);
}

export async function syncNovaPoshtaReferenceData(
  client: NovaPoshtaClient,
  db: Db,
): Promise<{ settlements: number; warehouses: number }> {
  const settlements = await syncSettlements(client, db);
  const warehouses = await syncWarehouses(client, db);
  await refreshSettlementWarehouseCounts(db);
  return { settlements, warehouses };
}
