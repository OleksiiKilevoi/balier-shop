import { describe, expect, it } from 'vitest';
import { PARCEL_SIZES, parcelSizeForOrder } from './parcel';

describe('parcelSizeForOrder', () => {
  it('one small unit → small box', () => {
    expect(parcelSizeForOrder([{ parcelSize: 'small', quantity: 1 }])).toBe('small');
  });

  it('a large product, or more than one unit, → large box', () => {
    expect(parcelSizeForOrder([{ parcelSize: 'large', quantity: 1 }])).toBe('large');
    expect(parcelSizeForOrder([{ parcelSize: 'small', quantity: 2 }])).toBe('large');
    expect(
      parcelSizeForOrder([
        { parcelSize: 'small', quantity: 1 },
        { parcelSize: 'small', quantity: 1 },
      ]),
    ).toBe('large');
  });

  it('each box stays inside its tariff tier by volumetric weight', () => {
    for (const [size, box] of Object.entries(PARCEL_SIZES)) {
      const volumetricGrams = ((box.cm.length * box.cm.width * box.cm.height) / 4000) * 1000;
      expect(volumetricGrams, size).toBeLessThanOrEqual(box.weightGrams);
    }
  });
});
