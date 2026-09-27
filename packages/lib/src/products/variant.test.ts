import { describe, expect, it } from 'vitest';
import { variantLabel } from './variant';

describe('variantLabel', () => {
  it('joins colour and size, and drops what is missing', () => {
    expect(variantLabel('Чорний', 'M')).toBe('Чорний · M');
    expect(variantLabel(null, 'L')).toBe('L');
    expect(variantLabel('Чорний', null)).toBe('Чорний');
    expect(variantLabel(null, null)).toBeNull();
    expect(variantLabel(' ', '')).toBeNull();
  });
});
