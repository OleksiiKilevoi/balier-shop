import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { foldQuery } from '../../novaposhta/normalize';
import type { Db } from '../index';
import { npSettlements, npWarehouses } from '../schema';

/**
 * Delivery-picker queries for `/checkout`. Both read `np_settlements` /
 * `np_warehouses` — our own DB, kept fresh by `src/novaposhta/sync.ts` —
 * never the live Nova Poshta API. Proxying autocomplete straight to NP on
 * every keystroke is explicitly the thing `docs/OVERVIEW.md` rules out.
 *
 * Matching happens against `search_text`, not `name`: the customer may be
 * typing Ukrainian, Russian or Latin, on a keyboard that may not even have the
 * letters the real name needs. `src/novaposhta/normalize.ts` explains the fold;
 * the rule here is simply that the query goes through the *same* fold the sync
 * used, or the index matches nothing.
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

const settlementColumns = {
  ref: npSettlements.ref,
  name: npSettlements.name,
  area: npSettlements.area,
  region: npSettlements.region,
  type: npSettlements.type,
};

/**
 * Escaping `%` and `_` is strictly belt-and-braces here: `fold()` turns every
 * non-alphanumeric character into a space, so neither can survive into a
 * folded query. Kept anyway — the day someone calls this with unfolded input,
 * the failure should be "no results", not a full-table wildcard scan.
 */
function likeContains(token: string): string {
  return `%${token.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Below this a settlement search returns nothing at all — 26 791 rows and two
 * letters of input is not a result set worth rendering. Exported because the
 * screens that draw the dropdown need to tell "keep typing" apart from "no such
 * place".
 */
export const SETTLEMENT_MIN_QUERY_LENGTH = 2;

/**
 * The fuzzy pass needs more to work with than the exact one: at two or three
 * characters trigram similarity matches almost anything, so a typo has to be a
 * typo of a real word before we start guessing.
 */
const SETTLEMENT_MIN_FUZZY_LENGTH = 4;

export async function searchSettlements(
  db: Db,
  query: string,
  limit = 10,
): Promise<SettlementResult[]> {
  const folded = foldQuery(query);
  if (folded.length < SETTLEMENT_MIN_QUERY_LENGTH) return [];

  /**
   * Plain alphabetical order buried "Київ" behind villages whose name also
   * starts with the typed letters (Ukrainian alphabetical order puts most of
   * them first) — confirmed live against real data while building this. Two
   * boosts fix it: a match at the start of a word ranks above a mid-word
   * match, and within a tier `warehouse_count` (a real city has hundreds, a
   * village has 0–1) ranks the settlement actually meant ahead of an obscure
   * namesake.
   *
   * A word boundary rather than a string prefix, because `search_text` holds
   * several spellings in sequence — «Львов» starts a word but never the blob.
   * The regex is safe unescaped for the same reason `likeContains` is.
   */
  const startsWord = sql<boolean>`${npSettlements.searchText} ~ ${`(^| )${folded}`}`;

  const exact = await db
    .select(settlementColumns)
    .from(npSettlements)
    .where(ilike(npSettlements.searchText, likeContains(folded)))
    .orderBy(desc(startsWord), desc(npSettlements.warehouseCount), asc(npSettlements.name))
    .limit(limit);

  if (exact.length > 0 || folded.length < SETTLEMENT_MIN_FUZZY_LENGTH) return exact;

  /**
   * Only reached when the customer typed something that matches nothing —
   * roughly, a real typo. Costs one extra round trip on that path and nothing
   * on the common one.
   *
   * `<%` is pg_trgm's word-similarity operator at its default 0.6 threshold,
   * and it is the *indexed* form: 0.1 ms against the GIN index, measured. The
   * obvious alternative — an explicit `word_similarity(…) >= 0.4` for more
   * forgiveness — was tried and rejected on measurement: it cannot use the
   * index (78 ms seq scan) and at that threshold the answers turn to noise
   * («кыив» → «Кононове-Івасів»). Most near-misses never get here anyway,
   * because the fold already absorbs the common ones.
   */
  return db
    .select(settlementColumns)
    .from(npSettlements)
    .where(sql`${folded} <% ${npSettlements.searchText}`)
    .orderBy(
      sql`word_similarity(${folded}, ${npSettlements.searchText}) desc`,
      desc(npSettlements.warehouseCount),
    )
    .limit(limit);
}

export interface SettlementSuggestion extends SettlementResult {
  /** True when this one came from the visitor's IP rather than the popularity list. */
  fromLocation: boolean;
}

/**
 * The chips offered under the settlement input before the customer types
 * anything, so the common case is one tap rather than eight keystrokes.
 *
 * Ranked by `warehouse_count`, not by population: it is the proxy this schema
 * already uses for "which settlement did they actually mean", it needs no
 * hardcoded list of refs to drift out of date, and for a delivery picker
 * "where Nova Poshta has the most branches" is arguably the more useful order
 * anyway. Today it yields Київ, Львів, Дніпро, Одеса — strict population order
 * would swap Львів for Харків.
 */
export async function topSettlements(db: Db, limit = 4): Promise<SettlementResult[]> {
  return db
    .select(settlementColumns)
    .from(npSettlements)
    .orderBy(desc(npSettlements.warehouseCount))
    .limit(limit);
}

/**
 * The popularity chips, plus the visitor's own city first when we can work out
 * what it is.
 *
 * `cityHint` is Cloudflare's IP geolocation, which names cities in Latin
 * ("Kyiv", "Lviv") — the `name_translit` spelling now folded into
 * `search_text` is exactly what makes that resolvable, so this costs no new
 * index. A hint that resolves to nothing simply doesn't add a chip: the
 * geolocation is a convenience, never a correctness input, and the customer
 * still has to confirm whatever it suggests.
 */
export async function settlementSuggestions(
  db: Db,
  cityHint: string | null,
  limit = 4,
): Promise<SettlementSuggestion[]> {
  const [top, located] = await Promise.all([
    topSettlements(db, limit),
    cityHint ? searchSettlements(db, cityHint, 1) : Promise.resolve([]),
  ]);

  const here = located[0];
  const suggestions: SettlementSuggestion[] = top
    .filter((settlement) => settlement.ref !== here?.ref)
    .map((settlement) => ({ ...settlement, fromLocation: false }));

  // Their own city leads, whether or not it was already in the popular four.
  return here ? [{ ...here, fromLocation: true }, ...suggestions] : suggestions;
}

/**
 * One settlement by ref.
 *
 * The admin panel's order form carries only the ref through its submits and
 * resolves the name here on every render, rather than shipping the name as a
 * second hidden field: a hidden name is a second copy of the truth that a
 * forged body could disagree with, and `orders.np_settlement_name` is what the
 * courier label is printed from.
 */
export async function findSettlement(db: Db, ref: string): Promise<SettlementResult | null> {
  const [row] = await db
    .select(settlementColumns)
    .from(npSettlements)
    .where(eq(npSettlements.ref, ref))
    .limit(1);

  return row ?? null;
}

/**
 * One warehouse by ref, carrying the two facts needed to decide whether it is
 * still a *valid* choice: which settlement it is in, and whether it is a
 * postomat. Switching the delivery method from «відділення» to «поштомат»
 * leaves the previously chosen ref pointing at the wrong kind of branch, and
 * only the row itself can say so — the ref is an opaque GUID.
 */
export interface WarehouseDetail extends WarehouseResult {
  settlementRef: string;
  isPostomat: boolean;
}

export async function findWarehouse(db: Db, ref: string): Promise<WarehouseDetail | null> {
  const [row] = await db
    .select({
      ref: npWarehouses.ref,
      number: npWarehouses.number,
      description: npWarehouses.description,
      settlementRef: npWarehouses.settlementRef,
      isPostomat: npWarehouses.isPostomat,
    })
    .from(npWarehouses)
    .where(and(eq(npWarehouses.ref, ref), eq(npWarehouses.isActive, true)))
    .limit(1);

  return row ?? null;
}

/**
 * Branch vs postomat is a stored boolean now, resolved once by the sync from
 * `type_ref`'s Ukrainian description. It used to be re-derived per request as
 * `type_ref ilike '%поштомат%'`, which no index can serve — Kyiv scanned 7 767
 * rows to return 50.
 *
 * `query` filters on `search_text` (which folds in both the Ukrainian and
 * Russian descriptions, and those carry the branch number and street address)
 * — needed because a plain unfiltered list isn't a "browse" affordance for
 * every settlement: Kyiv alone has 7 756 rows here, confirmed live against the
 * synced dev data.
 */
export async function listWarehouses(
  db: Db,
  settlementRef: string,
  kind: 'np_warehouse' | 'np_postomat',
  query = '',
  limit = 50,
): Promise<WarehouseResult[]> {
  const folded = foldQuery(query);

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
        eq(npWarehouses.isPostomat, kind === 'np_postomat'),
        folded ? ilike(npWarehouses.searchText, likeContains(folded)) : undefined,
      ),
    )
    // Numerically, so Kyiv opens 1, 2, 3 and not 1, 10, 10063. The handful with
    // no parseable number sort last rather than first.
    .orderBy(sql`${npWarehouses.numberSort} asc nulls last`, asc(npWarehouses.number))
    .limit(limit);
}
