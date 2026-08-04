import { neon, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

export * as schema from './schema';

/**
 * Read path. One HTTP round trip per statement, no connection to clean up.
 * Does NOT support interactive transactions — use `createTxDb` for those.
 *
 * Create this per request; never hoist it to module scope.
 */
export function createDb(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema });
}

export type Db = ReturnType<typeof createDb>;

/**
 * Write path for anything that must be atomic: order creation with stock
 * reservation, and the Monobank webhook transition.
 *
 * The caller MUST close the pool. Prefer:
 *
 *   const { db, close } = createTxDb(env.DATABASE_URL);
 *   try { ... } finally { ctx.waitUntil(close()); }
 */
export function createTxDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    db: drizzleWs(pool, { schema }),
    close: () => pool.end(),
  };
}

export type TxDb = ReturnType<typeof createTxDb>['db'];

/**
 * The type of the `tx` callback parameter inside `txDb.transaction(async (tx) => ...)`.
 * Drizzle's transaction object is not the same nominal type as `TxDb` itself
 * (it's a `PgTransaction`, not a `NeonDatabase`), even though it exposes the
 * same query builder — so functions called with either need to accept both.
 */
export type Tx = Parameters<Parameters<TxDb['transaction']>[0]>[0];
