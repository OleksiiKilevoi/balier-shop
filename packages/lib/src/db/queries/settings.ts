import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../index';
import { settings } from '../schema';
import type { Kopiykas } from '../../money';

/**
 * Admin-editable key/value settings.
 *
 * `scripts/seed.ts` writes the initial rows; `/admin/settings` is the only
 * thing that rewrites one afterwards. Every accessor keeps a fallback for a row
 * that does not exist, rather than failing hard at checkout — a missing setting
 * must never be the reason an order cannot be placed.
 */

const DEFAULT_COD_LIMIT: Kopiykas = 500_000; // 5 000 UAH, matches the seed value.
const DEFAULT_PAYMENT_TTL_MINUTES = 30;

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

/**
 * Minutes an unpaid card order stays payable: the validity stamped on its
 * Monobank invoice, and the age at which the cron sweeps the order itself.
 *
 * Stored under `reservation_ttl_minutes` until 2026-08-10 — it was the life of
 * a stock reservation back when stock was counted. Migration `0016` renames the
 * row; the fallback covers a database where neither key was ever written.
 */
export async function getPaymentTtlMinutes(db: Db): Promise<number> {
  const value = await readSetting(db, 'payment_ttl_minutes');
  return typeof value === 'number' ? value : DEFAULT_PAYMENT_TTL_MINUTES;
}

/* ------------------------------------------------------------------ promo */

export interface PromoSettings {
  /** Off = the popup never shows and no code can be redeemed. */
  enabled: boolean;
  /** Whole percent off the items total, 1–90. */
  percent: number;
}

const DEFAULT_PROMO_PERCENT = 10;

/** The e-mail promo: off until the owner switches it on in `/settings`. */
export async function getPromoSettings(db: Db): Promise<PromoSettings> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, ['promo_enabled', 'promo_percent']));
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const percent = byKey.get('promo_percent');
  return {
    enabled: byKey.get('promo_enabled') === true,
    percent: typeof percent === 'number' ? percent : DEFAULT_PROMO_PERCENT,
  };
}

export async function setPromoSettings(db: Db, values: PromoSettings): Promise<void> {
  await writeSetting(db, 'promo_enabled', values.enabled);
  await writeSetting(db, 'promo_percent', values.percent);
}

/* ------------------------------------------------------------- nova poshta */

/**
 * Everything a waybill needs to know about the *sender*, plus the two shop-wide
 * defaults its form starts from. Settings rather than config on purpose: every
 * one of these changes when the shop moves onto the client's own Nova Poshta
 * account in Phase 5, and that migration must be data entry, not a deploy
 * (docs/plans/novaposhta.md).
 *
 * All nullable, with no defaults anywhere: the panel is usable long before
 * somebody pastes a counterparty ref in, and the waybill form — not this
 * record — is what refuses while a value it needs is missing, naming it.
 */
export interface NpSenderSettings {
  /** `Counterparty` Ref with the Sender property, from the NP account. */
  counterpartyRef: string | null;
  /** Contact-person Ref under that counterparty. */
  contactRef: string | null;
  /**
   * What the account calls those two refs («Приватна особа», «Шулежко
   * Михайло…») — written by the same fetch that writes the refs, and only for
   * the screen: a UUID answers nothing when an admin wonders whose name goes
   * on the parcels.
   */
  counterpartyName: string | null;
  contactName: string | null;
  /** Sender's phone, normalised to `+380XXXXXXXXX` like every phone here. */
  phone: string | null;
  /** City and branch the parcels are handed over at. */
  cityRef: string | null;
  warehouseRef: string | null;
  /** What the waybill says is inside, e.g. «Аксесуари зі шкіри». */
  cargoDescription: string | null;
}

/** One row per value — the same shape the COD limit uses, times eight. */
const NP_KEYS = {
  counterpartyRef: 'np_sender_counterparty_ref',
  contactRef: 'np_sender_contact_ref',
  counterpartyName: 'np_sender_counterparty_name',
  contactName: 'np_sender_contact_name',
  phone: 'np_sender_phone',
  cityRef: 'np_sender_city_ref',
  warehouseRef: 'np_sender_warehouse_ref',
  cargoDescription: 'np_cargo_description',
} as const;

function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * `updatedAt` is the newest of the rows that exist, `null` when none do — the
 * same distinction the COD limit draws between «never changed» and «no row at
 * all», though here there is nothing to fall back on: missing is missing.
 */
export async function getNpSenderSettings(
  db: Db,
): Promise<{ values: NpSenderSettings; updatedAt: Date | null }> {
  const rows = await db
    .select({ key: settings.key, value: settings.value, updatedAt: settings.updatedAt })
    .from(settings)
    .where(inArray(settings.key, Object.values(NP_KEYS)));

  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  let updatedAt: Date | null = null;
  for (const row of rows) {
    if (updatedAt === null || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
  }

  return {
    values: {
      counterpartyRef: asText(byKey.get(NP_KEYS.counterpartyRef)),
      contactRef: asText(byKey.get(NP_KEYS.contactRef)),
      counterpartyName: asText(byKey.get(NP_KEYS.counterpartyName)),
      contactName: asText(byKey.get(NP_KEYS.contactName)),
      phone: asText(byKey.get(NP_KEYS.phone)),
      cityRef: asText(byKey.get(NP_KEYS.cityRef)),
      warehouseRef: asText(byKey.get(NP_KEYS.warehouseRef)),
      cargoDescription: asText(byKey.get(NP_KEYS.cargoDescription)),
    },
    updatedAt,
  };
}

/**
 * Writes only the fields it is handed — the section is edited by three
 * different forms now (the account fetch, the branch picker, the defaults),
 * and each owns its own subset. A field *present* with `null` is a clearing,
 * a field absent is untouched. Sequential rather than transactional — each row
 * is independently meaningful and the screen re-reads them all on the way out.
 */
export async function updateNpSenderSettings(
  db: Db,
  values: Partial<NpSenderSettings>,
): Promise<void> {
  for (const [field, key] of Object.entries(NP_KEYS) as [keyof NpSenderSettings, string][]) {
    if (field in values) await writeSetting(db, key, values[field] ?? null);
  }
}

/* ------------------------------------------------------------ home banner */

export interface BannerImage {
  /** Site-relative `/media/…`, like `product_images.url`. */
  url: string;
  /** Intrinsic size, so the page reserves the box before the file arrives. */
  width: number | null;
  height: number | null;
}

/**
 * The picture above «Рекомендовані товари» on the homepage. One row holding
 * the whole object — it is only ever read and written whole.
 */
export interface BannerSettings {
  enabled: boolean;
  image: BannerImage | null;
  /** Shown under 640 px instead of `image`; `null` means `image` everywhere. */
  imageMobile: BannerImage | null;
  /** Where a click goes; `null` means the picture is not a link. */
  link: string | null;
  alt: string | null;
}

function asBannerImage(value: unknown): BannerImage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { url, width, height } = value as Record<string, unknown>;
  if (typeof url !== 'string' || url === '') return null;
  return {
    url,
    width: typeof width === 'number' ? width : null,
    height: typeof height === 'number' ? height : null,
  };
}

export async function getBannerSettings(db: Db): Promise<BannerSettings> {
  const value = await readSetting(db, 'home_banner');
  const row = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    enabled: row.enabled === true,
    image: asBannerImage(row.image),
    imageMobile: asBannerImage(row.imageMobile),
    link: asText(row.link),
    alt: asText(row.alt),
  };
}

export async function setBannerSettings(db: Db, values: BannerSettings): Promise<void> {
  await writeSetting(db, 'home_banner', values);
}
