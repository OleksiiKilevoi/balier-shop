import { and, asc, desc, eq, ilike, notIlike, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { npSettlements, npWarehouses } from '../schema';

/**
 * Delivery-picker queries for `/checkout`. Both read `np_settlements` /
 * `np_warehouses` — our own DB, kept fresh by `src/lib/novaposhta/sync.ts` —
 * never the live Nova Poshta API. Proxying autocomplete straight to NP on
 * every keystroke is explicitly the thing `docs/OVERVIEW.md` rules out.
 */

export interface SettlementResult {
  ref: string;
  name: string;
  area: string | null;
  region: string | null;
  /** Ukrainian settlement-type label ("місто" | "село" | …) — see `settlementTypeAbbreviation`. */
  type: string | null;
}

export interface WarehouseResult {
  ref: string;
  number: string | null;
  description: string;
}

/** Same LIKE-metacharacter escaping `searchProducts` uses, so `%`/`_` match literally. */
function likeContains(token: string): string {
  return `%${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function likeStartsWith(token: string): string {
  return `${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const MIN_QUERY_LENGTH = 2;

export async function searchSettlements(
  db: Db,
  query: string,
  limit = 10,
): Promise<SettlementResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  /**
   * Plain alphabetical order buried "Київ" behind villages whose name also
   * starts with the typed letters (Ukrainian alphabetical order puts most of
   * them first) — confirmed live against real data while building this. Two
   * boosts fix it: an exact-prefix match ranks above a mid-name contains
   * match, and within a tier `warehouse_count` (a real city has hundreds, a
   * village has 0–1) ranks the settlement actually meant ahead of an obscure
   * namesake.
   */
  const startsWith = sql<boolean>`${npSettlements.name} ilike ${likeStartsWith(trimmed)}`;

  return db
    .select({
      ref: npSettlements.ref,
      name: npSettlements.name,
      area: npSettlements.area,
      region: npSettlements.region,
      type: npSettlements.type,
    })
    .from(npSettlements)
    .where(ilike(npSettlements.name, likeContains(trimmed)))
    .orderBy(desc(startsWith), desc(npSettlements.warehouseCount), asc(npSettlements.name))
    .limit(limit);
}

/**
 * `type_ref` holds the *resolved* Ukrainian description of `TypeOfWarehouse`
 * (e.g. `Відділення`, `Поштомат`) rather than NP's raw type-ref GUID — see the
 * comment in `src/lib/novaposhta/sync.ts` for why. Matching on that text is
 * what distinguishes a `np_warehouse` pickup from a `np_postomat` one, without
 * hardcoding a type-ref constant this codebase never independently verified.
 *
 * `query` filters on `description` (which carries both the branch number and
 * its street address) — needed because a plain unfiltered list isn't a
 * "browse" affordance for every settlement: Kyiv alone has 7 756 rows here,
 * confirmed live against the synced dev data.
 */
export async function listWarehouses(
  db: Db,
  settlementRef: string,
  kind: 'np_warehouse' | 'np_postomat',
  query = '',
  limit = 50,
): Promise<WarehouseResult[]> {
  const typeCondition =
    kind === 'np_postomat'
      ? ilike(npWarehouses.typeRef, '%поштомат%')
      : notIlike(npWarehouses.typeRef, '%поштомат%');
  const trimmed = query.trim();

  return db
    .select({
      ref: npWarehouses.ref,
      number: npWarehouses.number,
      description: npWarehouses.description,
    })
    .from(npWarehouses)
    .where(
      and(
        eq(npWarehouses.settlementRef, settlementRef),
        eq(npWarehouses.isActive, true),
        typeCondition,
        trimmed ? ilike(npWarehouses.description, likeContains(trimmed)) : undefined,
      ),
    )
    .orderBy(asc(npWarehouses.number))
    .limit(limit);
}
