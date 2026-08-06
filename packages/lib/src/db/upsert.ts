import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';

/**
 * `ON CONFLICT DO UPDATE` helpers for the reference-data syncs.
 *
 * The Nova Poshta sync re-upserts all ~80 000 rows nightly, and Postgres has no
 * in-place update: a row whose values are identical to the ones already stored
 * is still written as a new tuple, leaving the old one behind for autovacuum.
 * That rewrite cost the dev database ~50 MB of churn per night — most of the
 * project's storage was retained history for writes that changed nothing.
 *
 * `setWhere: differsFromExcluded(...)` makes the update conditional, so an
 * unchanged row is skipped entirely. The two helpers deliberately take the
 * *same* key list: if they could drift, a column present in the `set` but
 * missing from the comparison would simply stop syncing — silently, and only
 * for rows where nothing else changed too. Derive both from one constant.
 */

type ColumnKey<T extends PgTable> = Extract<keyof T['_']['columns'], string>;

function nameOf<T extends PgTable>(table: T, key: ColumnKey<T>): string {
  // Every key here is a real column of `table` (the type guarantees it), so the
  // lookup cannot miss; the quoting is belt-and-braces for snake_case names.
  return `"${getTableColumns(table)[key]!.name}"`;
}

/**
 * `{ search_text: sql`excluded.search_text`, … }` for the given columns — the
 * "just take whatever the feed sent" half of an upsert.
 */
export function setFromExcluded<T extends PgTable, K extends ColumnKey<T>>(
  table: T,
  keys: readonly K[],
): Pick<PgUpdateSetSource<T>, K> {
  return Object.fromEntries(
    keys.map((key) => [key, sql.raw(`excluded.${nameOf(table, key)}`)]),
  ) as Pick<PgUpdateSetSource<T>, K>;
}

/**
 * `(a, b, …) is distinct from (excluded.a, excluded.b, …)` — true only when the
 * incoming row actually differs from the stored one. Row-wise `IS DISTINCT
 * FROM` is what makes this correct for nullable columns: a plain `<>` returns
 * NULL when either side is NULL, which would skip updates on exactly the
 * columns Nova Poshta most often starts or stops sending.
 */
export function differsFromExcluded<T extends PgTable, K extends ColumnKey<T>>(
  table: T,
  keys: readonly K[],
): SQL {
  const columns = getTableColumns(table);
  const stored = keys.map((key) => sql`${columns[key]!}`);
  const incoming = keys.map((key) => sql.raw(`excluded.${nameOf(table, key)}`));

  return sql`(${sql.join(stored, sql`, `)}) is distinct from (${sql.join(incoming, sql`, `)})`;
}
