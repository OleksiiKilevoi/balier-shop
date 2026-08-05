import { eq } from 'drizzle-orm';
import type { Db } from '../index';
import { settings } from '../schema';
import type { Kopiykas } from '~/lib/money';

/**
 * Admin-editable key/value settings.
 *
 * `scripts/seed.ts` writes the initial rows; `/admin/settings` is the only
 * thing that rewrites one afterwards. Every accessor keeps a fallback for a row
 * that does not exist, rather than failing hard at checkout — a missing setting
 * must never be the reason an order cannot be placed.
 */

const DEFAULT_COD_LIMIT: Kopiykas = 500_000; // 5 000 UAH, matches the seed value.
const DEFAULT_RESERVATION_TTL_MINUTES = 30;

interface SettingRow {
  value: unknown;
  updatedAt: Date;
}

async function readSettingRow(db: Db, key: string): Promise<SettingRow | undefined> {
  const [row] = await db
    .select({ value: settings.value, updatedAt: settings.updatedAt })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row;
}

async function readSetting(db: Db, key: string): Promise<unknown> {
  return (await readSettingRow(db, key))?.value;
}

/**
 * Upsert, because the seed is not guaranteed to have run on this database —
 * a settings screen that could only ever edit a row somebody else created would
 * fail exactly where it is needed most, on a fresh deployment.
 *
 * `updatedAt` is written explicitly: the column defaults to `now()` on insert,
 * but the schema attaches no `$onUpdate`, so an update that did not set it would
 * silently keep reporting the moment the row was seeded.
 */
async function writeSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Kopiykas. Orders above this amount cannot use cash on delivery. */
export async function getCodLimitKopiykas(db: Db): Promise<Kopiykas> {
  const value = await readSetting(db, 'cod_limit');
  return typeof value === 'number' ? value : DEFAULT_COD_LIMIT;
}

/**
 * The same value plus when it was last written, for the one screen that edits
 * it. `updatedAt` is `null` when no row exists at all — which is not the same as
 * "never changed", and the screen says so rather than showing the fallback as if
 * somebody had chosen it.
 */
export async function getCodLimitSetting(
  db: Db,
): Promise<{ kopiykas: Kopiykas; updatedAt: Date | null }> {
  const row = await readSettingRow(db, 'cod_limit');
  return {
    kopiykas: typeof row?.value === 'number' ? row.value : DEFAULT_COD_LIMIT,
    updatedAt: typeof row?.value === 'number' ? row.updatedAt : null,
  };
}

export async function setCodLimitKopiykas(db: Db, value: Kopiykas): Promise<void> {
  await writeSetting(db, 'cod_limit', value);
}

/** Minutes a stock reservation is held for an unpaid order before it lapses. */
export async function getReservationTtlMinutes(db: Db): Promise<number> {
  const value = await readSetting(db, 'reservation_ttl_minutes');
  return typeof value === 'number' ? value : DEFAULT_RESERVATION_TTL_MINUTES;
}
