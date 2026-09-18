import type { ParcelSize } from '../db/schema';

/**
 * The two boxes the shop ships in, as Nova Poshta's tariff sees them. The
 * carrier charges by the larger of actual and volumetric weight
 * (L×W×H / 4000), so each box's dimensions are chosen to stay inside its tier:
 * 30×25×10 → 1.9 kg, 45×35×25 → 9.8 kg. The declared weight is the tier's
 * ceiling — «до 2 кг» is a box, not a measurement.
 *
 * ponytail: constants, not settings. Move them to `/settings` when the owner
 * asks to change a box size, not before.
 */
export const PARCEL_SIZES: Record<
  ParcelSize,
  { weightGrams: number; cm: { length: number; width: number; height: number } }
> = {
  small: { weightGrams: 2000, cm: { length: 30, width: 25, height: 10 } },
  large: { weightGrams: 10000, cm: { length: 45, width: 35, height: 25 } },
};

/**
 * The box to prefill for an order: one unit of a small-box product fits the
 * small box, anything more does not. A guess the operator can overrule on the
 * form — two wallets may well share a small box.
 */
export function parcelSizeForOrder(
  items: readonly { parcelSize: ParcelSize; quantity: number }[],
): ParcelSize {
  const units = items.reduce((total, item) => total + item.quantity, 0);
  return units === 1 && items[0]?.parcelSize === 'small' ? 'small' : 'large';
}
