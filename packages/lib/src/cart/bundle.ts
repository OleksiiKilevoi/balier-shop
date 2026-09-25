import type { Kopiykas } from '../money';
import { discountFor } from '../orders/promo';

/**
 * The bundle price: a product can name a companion (a bag → its card holder)
 * and a percentage off it. Every unit of the main product in the cart earns
 * one companion unit at that price; companion units beyond that pay full.
 *
 * Pure, and the only place the rule lives: the cart summary, the checkout
 * resolver and the panel's order preview all call it, so the price the
 * customer sees is the price the order is written with.
 */

export interface BundleRule {
  /** The main product. */
  productId: string;
  companionProductId: string;
  percent: number;
}

export interface BundleLineInput {
  productId: string;
  unitPrice: Kopiykas;
  quantity: number;
}

export interface BundlePricing {
  /** Units of this line sold at `bundleUnitPrice`; the rest are at `unitPrice`. */
  bundleUnits: number;
  bundleUnitPrice: Kopiykas;
  lineTotal: Kopiykas;
}

export function bundleUnitPrice(unitPrice: Kopiykas, percent: number): Kopiykas {
  return unitPrice - discountFor(unitPrice, percent);
}

/** Pricing per input line, in the same order. */
export function applyBundles(
  lines: readonly BundleLineInput[],
  rules: readonly BundleRule[],
): BundlePricing[] {
  const earned = earnedUnits(lines, rules);

  return lines.map((line) => {
    const pool = earned.get(line.productId);
    const bundleUnits = pool && pool.percent > 0 ? Math.min(pool.units, line.quantity) : 0;
    if (pool) pool.units -= bundleUnits;
    const price = bundleUnits > 0 ? bundleUnitPrice(line.unitPrice, pool!.percent) : line.unitPrice;
    return {
      bundleUnits,
      bundleUnitPrice: price,
      lineTotal: price * bundleUnits + line.unitPrice * (line.quantity - bundleUnits),
    };
  });
}

/**
 * Companions worth offering: the main product is in the cart and has earned
 * more bundle units than the cart holds of its companion. One entry per
 * companion, at the percentage `applyBundles` would price it at.
 */
export function missingCompanions(
  lines: readonly BundleLineInput[],
  rules: readonly BundleRule[],
): { companionProductId: string; percent: number }[] {
  return [...earnedUnits(lines, rules)]
    .filter(([companionProductId, { units }]) => unitsOf(lines, companionProductId) < units)
    .map(([companionProductId, { percent }]) => ({ companionProductId, percent }));
}

function unitsOf(lines: readonly BundleLineInput[], productId: string): number {
  return lines.filter((line) => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * Per companion: how many bundle units the main products in the cart earn,
 * and at what percentage.
 * ponytail: several mains pointing at one companion pool their units at the
 * largest percentage; per-rule allocation if that ever needs to be exact.
 */
function earnedUnits(
  lines: readonly BundleLineInput[],
  rules: readonly BundleRule[],
): Map<string, { units: number; percent: number }> {
  const earned = new Map<string, { units: number; percent: number }>();
  for (const rule of rules) {
    // A 0 % companion is still offered; it just earns no discount.
    if (rule.companionProductId === rule.productId) continue;
    const units = unitsOf(lines, rule.productId);
    if (units === 0) continue;
    const current = earned.get(rule.companionProductId) ?? { units: 0, percent: 0 };
    earned.set(rule.companionProductId, {
      units: current.units + units,
      percent: Math.max(current.percent, rule.percent),
    });
  }
  return earned;
}
