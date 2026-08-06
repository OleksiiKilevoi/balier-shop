import { describe, expect, it } from 'vitest';
import { formatPhoneDigits, isCompletePhoneDigits, phoneDigitsFromInput } from './phone';

describe('phoneDigitsFromInput', () => {
  it('passes through plain local digits', () => {
    expect(phoneDigitsFromInput('501234567')).toBe('501234567');
  });

  it('strips a leading 0', () => {
    expect(phoneDigitsFromInput('0501234567')).toBe('501234567');
  });

  it('strips a leading 380 (pasted/autofilled full number)', () => {
    expect(phoneDigitsFromInput('380501234567')).toBe('501234567');
  });

  it('strips a leading +380', () => {
    expect(phoneDigitsFromInput('+380 50 123 45 67')).toBe('501234567');
  });

  it('caps at 9 digits', () => {
    expect(phoneDigitsFromInput('5012345678999')).toBe('501234567');
  });

  it('drops non-digit characters typed mid-string', () => {
    expect(phoneDigitsFromInput('50-123-45-67')).toBe('501234567');
  });
});

describe('formatPhoneDigits', () => {
  it('groups progressively as digits arrive', () => {
    expect(formatPhoneDigits('')).toBe('');
    expect(formatPhoneDigits('5')).toBe('5');
    expect(formatPhoneDigits('50')).toBe('50');
    expect(formatPhoneDigits('501')).toBe('50 1');
    expect(formatPhoneDigits('50123')).toBe('50 123');
    expect(formatPhoneDigits('5012345')).toBe('50 123 45');
    expect(formatPhoneDigits('501234567')).toBe('50 123 45 67');
  });
});

describe('isCompletePhoneDigits', () => {
  it('requires exactly 9 digits', () => {
    expect(isCompletePhoneDigits('50123456')).toBe(false);
    expect(isCompletePhoneDigits('501234567')).toBe(true);
  });
});
