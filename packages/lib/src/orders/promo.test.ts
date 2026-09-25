import { describe, expect, it } from 'vitest';
import { PROMO_CODE_PATTERN, campaignCode, discountFor, generatePromoCode, normalizePromoCode } from './promo';

describe('discountFor', () => {
  it('rounds to the kopiyka and never exceeds the total', () => {
    expect(discountFor(195_000, 10)).toBe(19_500);
    expect(discountFor(333, 10)).toBe(33);
    expect(discountFor(335, 10)).toBe(34);
    expect(discountFor(100, 100)).toBe(100);
    expect(discountFor(100, 0)).toBe(0);
  });
});

describe('generatePromoCode / normalizePromoCode', () => {
  it('produces the printed shape and normalises what a customer types', () => {
    const code = generatePromoCode();
    expect(code).toMatch(PROMO_CODE_PATTERN);
    expect(code.slice('BALIER-'.length)).not.toMatch(/[01OI]/);
    expect(normalizePromoCode('  balier-ab2cd ')).toBe('BALIER-AB2CD');
    expect(normalizePromoCode('BALIER - AB2CD')).toBe('BALIER-AB2CD');
  });
});

describe('campaignCode', () => {
  it('knows the shared codes and nothing else', () => {
    expect(campaignCode('BLR5')).toEqual({ percent: 5, firstOrderOnly: false });
    expect(campaignCode(normalizePromoCode(' 1blr '))).toEqual({ percent: 10, firstOrderOnly: true });
    expect(campaignCode('BLR10')).toBeNull();
    expect(campaignCode('toString')).toBeNull();
  });
});
