import { describe, expect, it } from 'vitest';
import { applyBundles, missingCompanions, type BundleRule } from './bundle';

const BAG = 'bag';
const HOLDER = 'holder';
const rule: BundleRule = { productId: BAG, companionProductId: HOLDER, percent: 20 };
const bag = (quantity = 1) => ({ productId: BAG, unitPrice: 1_550_000, quantity });
const holder = (quantity = 1) => ({ productId: HOLDER, unitPrice: 150_000, quantity });

describe('applyBundles', () => {
  it('prices one companion per main unit at the bundle price', () => {
    const [main, extra] = applyBundles([bag(), holder()], [rule]);
    expect(main).toEqual({ bundleUnits: 0, bundleUnitPrice: 1_550_000, lineTotal: 1_550_000 });
    expect(extra).toEqual({ bundleUnits: 1, bundleUnitPrice: 120_000, lineTotal: 120_000 });
  });

  it('charges full price for companion units beyond the main units', () => {
    const [, extra] = applyBundles([bag(1), holder(2)], [rule]);
    expect(extra).toEqual({ bundleUnits: 1, bundleUnitPrice: 120_000, lineTotal: 270_000 });
  });

  it('spreads earned units over several companion lines (colours) in order', () => {
    const [, first, second] = applyBundles([bag(2), holder(1), holder(3)], [rule]);
    expect(first!.bundleUnits).toBe(1);
    expect(second!.bundleUnits).toBe(1);
    expect(second!.lineTotal).toBe(120_000 + 2 * 150_000);
  });

  it('gives nothing without the main product, or without a rule', () => {
    expect(applyBundles([holder()], [rule])[0]!.lineTotal).toBe(150_000);
    expect(applyBundles([bag(), holder()], [])[1]!.lineTotal).toBe(150_000);
    expect(applyBundles([bag(), holder()], [{ ...rule, percent: 0 }])[1]!.bundleUnits).toBe(0);
  });

  it('rounds the discounted unit to a whole kopiyka', () => {
    const [, extra] = applyBundles([bag(), { productId: HOLDER, unitPrice: 333, quantity: 1 }], [
      { ...rule, percent: 15 },
    ]);
    expect(extra!.bundleUnitPrice).toBe(283);
  });
});

describe('missingCompanions', () => {
  it('offers the companion until the cart holds as many as the main earns', () => {
    expect(missingCompanions([bag()], [rule])).toEqual([{ companionProductId: HOLDER, percent: 20 }]);
    expect(missingCompanions([bag(2), holder(1)], [rule])).toHaveLength(1);
    expect(missingCompanions([bag(), holder()], [rule])).toEqual([]);
    expect(missingCompanions([holder()], [rule])).toEqual([]);
    expect(missingCompanions([bag()], [{ ...rule, percent: 0 }])).toEqual([
      { companionProductId: HOLDER, percent: 0 },
    ]);
  });
});
