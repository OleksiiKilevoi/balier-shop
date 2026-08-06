import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { npSettlements, npSyncSeen, npWarehouses } from '../db/schema';
import { differsFromExcluded, setFromExcluded } from '../db/upsert';
import type { NovaPoshtaClient } from './client';
import { addressSearchText, searchText } from './normalize';

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
 *
 * What it does *not* do any more is write rows that haven't changed. NP's
 * country-wide feed is near-static day to day, but re-upserting all ~80 000
 * rows regardless left a fresh tuple for every one of them nightly — by a wide
 * margin the dominant cost in the database (see `db/upsert.ts`). Every write
 * below is now conditional on the incoming row actually differing.
 */

interface RawSettlement {
  Ref: string;
  Description: string;
  /**
   * The Russian and Latin spellings, present on every row of `getSettlements`
   * and ignored by this sync until now. They are what lets «Львов» and «Lviv»
   * find «Львів» at checkout — see `src/novaposhta/normalize.ts`.
   */
  DescriptionRu?: string;
  DescriptionTranslit?: string;
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
  DescriptionRu?: string;
  Number?: string;
  SettlementRef?: string;
  CityRef?: string;
  TypeOfWarehouse?: string;
  TotalMaxWeightAllowed?: string;
  Longitude?: string;
  Latitude?: string;
  /** "Working" on every one of 1 500 rows sampled live; see `isSelectable`. */
  WarehouseStatus?: string;
  /** "1" when NP itself says this branch must not be offered as a choice. */
  DenyToSelect?: string;
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

/**
 * Every column the feed owns — `warehouse_count` is ours, derived below, and
 * must survive an upsert untouched. One list, so the `set` and the "did
 * anything change" test can never disagree.
 */
const SETTLEMENT_SYNCED = [
  'name',
  'nameRu',
  'nameTranslit',
  'searchText',
  'area',
  'region',
  'type',
  'deliveryCityRef',
] as const;

async function upsertSettlements(db: Db, rows: RawSettlement[]): Promise<void> {
  await db
    .insert(npSettlements)
    .values(
      rows.map((s) => ({
        ref: s.Ref,
        name: s.Description,
        nameRu: s.DescriptionRu ?? null,
        nameTranslit: s.DescriptionTranslit ?? null,
        searchText: searchText(s.Description, s.DescriptionRu, s.DescriptionTranslit),
        area: s.AreaDescription ?? null,
        region: s.RegionsDescription ?? null,
        type: s.SettlementTypeDescription ?? null,
        deliveryCityRef: s.DeliveryCity ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: npSettlements.ref,
      set: { ...setFromExcluded(npSettlements, SETTLEMENT_SYNCED), updatedAt: sql`now()` },
      setWhere: differsFromExcluded(npSettlements, SETTLEMENT_SYNCED),
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
 * Whether a branch may be offered at checkout. This used to be hardcoded
 * `true` for every row, which made the `is_active` filter in the pickers
 * decorative and kept closed branches selectable.
 *
 * `WarehouseStatus` read "Working" on all 1 500 rows sampled live against the
 * real API, so this changes nothing today and starts being correct the moment
 * NP closes one. A *missing* status counts as active on purpose: if NP ever
 * drops the field, the fail-safe is a stale-open branch someone has to reroute,
 * not a nationwide empty dropdown at checkout.
 */
function isSelectable(w: RawWarehouse): boolean {
  return (w.WarehouseStatus ?? 'Working') === 'Working' && w.DenyToSelect !== '1';
}

/**
 * NP's branch numbers are text because a few are not plain integers, but
 * ordering the picker by that text listed Kyiv as 1, 10, 10063, …, 101.
 * Bounded to 9 digits so nothing can overflow int4; anything else sorts last.
 */
function branchNumberSort(number: string | undefined): number | null {
  return number && /^\d{1,9}$/.test(number) ? Number(number) : null;
}

/** As `SETTLEMENT_SYNCED` — every warehouse column the feed owns. */
const WAREHOUSE_SYNCED = [
  'settlementRef',
  'number',
  'numberSort',
  'description',
  'descriptionRu',
  'searchText',
  'typeRef',
  'isPostomat',
  'maxWeightKg',
  'latitude',
  'longitude',
  // Retirement below writes this column too; a branch back in the feed gets its
  // own status back here, which is why a retired row is never a dead end.
  'isActive',
] as const;

/**
 * `TypeOfWarehouse` on a warehouse row is a reference-book GUID; resolving it
 * to its Ukrainian description here (via NP's own `getWarehouseTypes`, live-
 * verified against the real API while building this: it returns 5 rows,
 * including both `Поштомат` and `Поштомат ПриватБанку`) means
 * `np_warehouses.type_ref` ends up holding a human-readable label
 * (`Поштове(ий)`, `Поштомат`, …) instead of an opaque ref — which is what
 * `is_postomat` is resolved from once here, instead of by an unindexable
 * `ilike` on every request, and without this codebase ever having to hardcode
 * a NP type-ref constant it couldn't independently verify.
 */
async function syncWarehouses(client: NovaPoshtaClient, db: Db): Promise<number> {
  const warehouseTypes = await client.call<RawWarehouseType>({
    modelName: 'AddressGeneral',
    calledMethod: 'getWarehouseTypes',
  });
  const typeNameByRef = new Map(warehouseTypes.map((t) => [t.Ref, t.Description]));

  const upsertWarehouses = async (rows: RawWarehouse[]) => {
    // Marked seen before the upsert and from the *unfiltered* page: a branch NP
    // returned is a branch NP still has, even if we skip storing it for want of
    // a settlement ref. Retiring it because of a missing field would take it
    // out of checkout on the strength of one absent attribute.
    await db.insert(npSyncSeen).values(rows.map((w) => ({ ref: w.Ref })));

    await db
      .insert(npWarehouses)
      .values(
        rows
          .filter((w) => w.SettlementRef ?? w.CityRef)
          .map((w) => {
            const typeName = w.TypeOfWarehouse
              ? (typeNameByRef.get(w.TypeOfWarehouse) ?? null)
              : null;

            return {
              ref: w.Ref,
              settlementRef: (w.SettlementRef ?? w.CityRef)!,
              number: w.Number ?? null,
              numberSort: branchNumberSort(w.Number),
              description: w.Description,
              descriptionRu: w.DescriptionRu ?? null,
              searchText: addressSearchText(w.Description, w.DescriptionRu),
              typeRef: typeName,
              // Decided once here instead of by `ilike '%поштомат%'` on every
              // request, so the pickers can index the column.
              isPostomat: typeName ? /поштомат/i.test(typeName) : false,
              maxWeightKg: w.TotalMaxWeightAllowed
                ? Math.trunc(Number(w.TotalMaxWeightAllowed)) || null
                : null,
              latitude: w.Latitude ?? null,
              longitude: w.Longitude ?? null,
              isActive: isSelectable(w),
            };
          }),
      )
      .onConflictDoUpdate({
        target: npWarehouses.ref,
        set: { ...setFromExcluded(npWarehouses, WAREHOUSE_SYNCED), updatedAt: sql`now()` },
        setWhere: differsFromExcluded(npWarehouses, WAREHOUSE_SYNCED),
      });
  };

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
 * table's sync has finished.
 *
 * Two statements rather than one correlated UPDATE over every settlement,
 * because that form rewrote all ~27k rows nightly to store the number they
 * already held: one aggregate pass joined back to the settlements whose count
 * moved, and one for the settlements that lost their last active branch and so
 * appear in no group at all.
 */
async function refreshSettlementWarehouseCounts(db: Db): Promise<void> {
  await db.execute(sql`
    update ${npSettlements} as s
    set warehouse_count = counted.n, updated_at = now()
    from (
      select ${npWarehouses.settlementRef} as ref, count(*)::int as n
      from ${npWarehouses}
      where ${npWarehouses.isActive}
      group by ${npWarehouses.settlementRef}
    ) as counted
    where counted.ref = s.ref and s.warehouse_count <> counted.n
  `);

  await db.execute(sql`
    update ${npSettlements} as s
    set warehouse_count = 0, updated_at = now()
    where s.warehouse_count <> 0
      and not exists (
        select 1 from ${npWarehouses}
        where ${npWarehouses.settlementRef} = s.ref and ${npWarehouses.isActive}
      )
  `);
}

/**
 * A branch NP has removed from the feed entirely is never visited by the
 * upsert loop above, so before this it stayed in our table — active and
 * selectable — forever. Anything the run did not touch gets retired.
 *
 * Two guards, because the failure mode here is deactivating the country:
 *
 *  - The caller only reaches this after the warehouse pagination *finished*.
 *    A run that throws partway (NP rate-limiting is a documented real risk
 *    here) has touched a fraction of the table and must not retire the rest.
 *  - Even then, a run that saw implausibly few rows is treated as a truncated
 *    feed rather than as 40 000 closures, and retires nothing.
 *
 * "Did not touch" used to mean "whose `updated_at` is older than this run",
 * which needed a clock-skew allowance and, worse, only worked while the sync
 * rewrote every row every night. It now means "whose ref is not in
 * `np_sync_seen`" — an exact set, recorded per page, with no clock in it.
 */
const RETIRE_MIN_SEEN_RATIO = 0.5;

async function retireUnseenWarehouses(db: Db, seen: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npWarehouses)
    .where(eq(npWarehouses.isActive, true));
  const total = row?.total ?? 0;

  if (total === 0) return 0;
  if (seen < total * RETIRE_MIN_SEEN_RATIO) {
    console.warn(
      `Nova Poshta sync saw ${seen} warehouses against ${total} active rows — ` +
        'treating the feed as truncated and retiring nothing.',
    );
    return 0;
  }

  const retired = await db
    .update(npWarehouses)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(npWarehouses.isActive, true),
        sql`not exists (
          select 1 from ${npSyncSeen}
          where ${npSyncSeen.ref} = ${npWarehouses.ref}
        )`,
      ),
    )
    .returning({ ref: npWarehouses.ref });

  return retired.length;
}

export async function syncNovaPoshtaReferenceData(
  client: NovaPoshtaClient,
  db: Db,
): Promise<{ settlements: number; warehouses: number; retired: number }> {
  const settlements = await syncSettlements(client, db);

  // Truncate rather than delete: this table is rewritten whole every run, and
  // 53k dead tuples a night is the exact cost the rest of this change removes.
  // A run that dies partway leaves a partial set behind, which is harmless —
  // retirement is unreachable unless the pagination below completes, and the
  // next run clears it here.
  await db.execute(sql`truncate ${npSyncSeen}`);

  const warehouses = await syncWarehouses(client, db);
  const retired = await retireUnseenWarehouses(db, warehouses);

  await refreshSettlementWarehouseCounts(db);
  return { settlements, warehouses, retired };
}
