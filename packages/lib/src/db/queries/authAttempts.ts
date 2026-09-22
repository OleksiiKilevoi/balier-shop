import { eq, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { authAttempts } from '../schema';

/**
 * The admin login's budget, counted atomically (`auth_attempts`). Same two
 * halves as the KV limiter it replaces on that one form: a wrong password
 * spends a unit, a right one spends nothing, so an operator having a bad
 * morning cannot lock themselves out by eventually signing in.
 *
 * The difference is that `spend` is a single `INSERT … ON CONFLICT DO UPDATE …
 * RETURNING`, so N parallel guesses cost N units rather than one, and every
 * colo reads the same number. Overshoot is bounded by how many requests are in
 * flight at once, not by KV's propagation delay.
 */
export interface AttemptBudget {
  allowed: boolean;
  /** Seconds until the window resets — only meaningful when `!allowed`. */
  retryAfterSeconds: number;
}

function budget(
  row: { count: number; windowStart: Date } | undefined,
  limit: number,
  windowSeconds: number,
): AttemptBudget {
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  const elapsedSeconds = (Date.now() - row.windowStart.getTime()) / 1000;
  // An expired window is an empty one; `spend` resets it on the next write.
  if (elapsedSeconds >= windowSeconds) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: row.count < limit,
    retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - elapsedSeconds)),
  };
}

/** «Would this be allowed?» — reads, spends nothing. */
export async function peekAuthAttempts(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<AttemptBudget> {
  const [row] = await db
    .select({ count: authAttempts.count, windowStart: authAttempts.windowStart })
    .from(authAttempts)
    .where(eq(authAttempts.key, key))
    .limit(1);

  return budget(row, limit, windowSeconds);
}

/**
 * Spend one unit and report the budget *after* spending it. The `case`s reset
 * a window that has run out inside the same statement, so there is no read to
 * race and no sweeper to depend on.
 */
export async function spendAuthAttempt(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<AttemptBudget> {
  const expired = sql`${authAttempts.windowStart} <= now() - make_interval(secs => ${windowSeconds})`;

  const [row] = await db
    .insert(authAttempts)
    .values({ key, count: 1 })
    .onConflictDoUpdate({
      target: authAttempts.key,
      set: {
        count: sql`case when ${expired} then 1 else ${authAttempts.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${authAttempts.windowStart} end`,
      },
    })
    .returning({ count: authAttempts.count, windowStart: authAttempts.windowStart });

  return budget(row, limit, windowSeconds);
}

/**
 * Nightly housekeeping from `workers/cron`: a row survives its window so the
 * count can be read back, but nothing needs yesterday's.
 */
export async function pruneAuthAttempts(db: Db): Promise<number> {
  const deleted = await db
    .delete(authAttempts)
    .where(sql`${authAttempts.windowStart} < now() - interval '1 day'`)
    .returning({ key: authAttempts.key });
  return deleted.length;
}
