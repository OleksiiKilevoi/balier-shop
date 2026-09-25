import { describe, expect, it } from 'vitest';
import { partsFailureText } from './checkout';

describe('partsFailureText', () => {
  it('explains the documented codes and falls back for the rest', () => {
    expect(partsFailureText('CLIENT_NOT_FOUND')).toContain('не зареєстрований у monobank');
    expect(partsFailureText('EXCEEDED_SUM_LIMIT')).toContain('ліміт');
    const fallback = partsFailureText(null);
    expect(fallback).toContain('monobank не погодив заявку');
    expect(partsFailureText('ACCOUNT_CLOSED')).toBe(fallback);
    expect(partsFailureText('toString')).toBe(fallback);
  });
});
