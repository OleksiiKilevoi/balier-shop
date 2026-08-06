import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { npWarehouses } from './schema';
import { differsFromExcluded, setFromExcluded } from './upsert';

/**
 * These render SQL rather than run it — the point of the helpers is the shape
 * of the statement, and getting that wrong is silent: an upsert that compares
 * the wrong columns still succeeds, it just stops syncing them.
 */
const render = (query: SQL) => new PgDialect().sqlToQuery(query).sql;

describe('setFromExcluded', () => {
  it('maps each key to the incoming row, under the column name from the schema', () => {
    const set = setFromExcluded(npWarehouses, ['settlementRef', 'searchText']);

    expect(Object.keys(set)).toEqual(['settlementRef', 'searchText']);
    expect(render(set.settlementRef as SQL)).toBe('excluded."settlement_ref"');
    expect(render(set.searchText as SQL)).toBe('excluded."search_text"');
  });
});

describe('differsFromExcluded', () => {
  it('compares the stored row against the incoming one, row-wise', () => {
    expect(render(differsFromExcluded(npWarehouses, ['description', 'isActive']))).toBe(
      '("np_warehouses"."description", "np_warehouses"."is_active") is distinct from ' +
        '(excluded."description", excluded."is_active")',
    );
  });

  it('uses IS DISTINCT FROM, not <>, so a NULL on either side still counts as a change', () => {
    // `latitude <> excluded.latitude` is NULL — not true — when NP starts or
    // stops sending a coordinate, which would pin the row to its stale value.
    expect(render(differsFromExcluded(npWarehouses, ['latitude']))).toContain('is distinct from');
  });

  it('covers exactly the columns the upsert writes', () => {
    // The two helpers are only safe while they take the same list: a column in
    // the `set` but not the comparison never syncs again. Asserted here on the
    // real pair rather than trusted to review.
    const keys = ['settlementRef', 'number', 'isPostomat'] as const;
    const compared = render(differsFromExcluded(npWarehouses, keys));

    for (const key of Object.keys(setFromExcluded(npWarehouses, keys))) {
      const column = npWarehouses[key as keyof typeof npWarehouses] as { name: string };
      expect(compared).toContain(`"${column.name}"`);
    }
  });
});
