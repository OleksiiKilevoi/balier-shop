import { eq } from 'drizzle-orm';
import type { Db } from '../index';
import { settings } from '../schema';
import type { Kopiykas } from '~/lib/money';

/**
 * Admin-editable key/value settings. There is no admin UI to write these yet
 * (Phase 4) — `scripts/seed.ts` is the only writer today — so these are
 * read-only accessors over the seeded rows, with a fallback for a row that
 * somehow does not exist rather than a hard failure at checkout.
 */

const DEFAULT_COD_LIMIT: Kopiykas = 500_000; // 5 000 UAH, matches the seed value.
const DEFAULT_RESERVATION_TTL_MINUTES = 30;

async function readSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value;
}

/** Kopiykas. Orders above this amount cannot use cash on delivery. */
export async function getCodLimitKopiykas(db: Db): Promise<Kopiykas> {
  const value = await readSetting(db, 'cod_limit');
  return typeof value === 'number' ? value : DEFAULT_COD_LIMIT;
}

/** Minutes a stock reservation is held for an unpaid order before it lapses. */
export async function getReservationTtlMinutes(db: Db): Promise<number> {
  const value = await readSetting(db, 'reservation_ttl_minutes');
  return typeof value === 'number' ? value : DEFAULT_RESERVATION_TTL_MINUTES;
}
