import { describe, expect, it } from 'vitest';
import {
  COD_LIMIT_MAX_HRYVNIAS,
  COD_LIMIT_MIN_HRYVNIAS,
  adminSettingsSchema,
  codLimitSchema,
} from './admin';

/**
 * The cash-on-delivery limit is the one setting the panel writes, and it is the
 * only place in the codebase where a *human-entered* amount becomes kopiykas.
 * Everything downstream — `createOrder`'s refusal, `/api/checkout`'s
 * `cod_over_limit`, the note on `/checkout` — compares against whatever this
 * produces, so a factor-of-100 slip here would quietly move the threshold for
 * every customer at once. Hence the unit assertions below are exact numbers,
 * not round trips through `hryvnias`.
 */

function parse(raw: string) {
  return codLimitSchema.safeParse(raw);
}

describe('codLimitSchema', () => {
  it('converts whole hryvnias to kopiykas', () => {
    expect(parse('5000').data).toBe(500_000);
    expect(parse('1').data).toBe(100);
  });

  it('accepts the separators a pasted or copied amount arrives with', () => {
    // A plain space, the NBSP `formatPrice` emits, and an apostrophe.
    expect(parse('5 000').data).toBe(500_000);
    expect(parse('5 000').data).toBe(500_000);
    expect(parse("5'000").data).toBe(500_000);
    expect(parse('  5000  ').data).toBe(500_000);
  });

  it('refuses anything that is not a plain whole number', () => {
    for (const raw of ['', '   ', 'abc', '5000₴', '-100', '1e5', '5.5', '5,5', '4999.99']) {
      expect(parse(raw).success, raw).toBe(false);
    }
  });

  it('refuses a decimal even when it is a whole number of hryvnias', () => {
    // `5000.00` is not a typo worth guessing at — see the schema's comment.
    expect(parse('5000.00').success).toBe(false);
  });

  it('enforces the bounds inclusively', () => {
    expect(parse(String(COD_LIMIT_MIN_HRYVNIAS)).success).toBe(true);
    expect(parse(String(COD_LIMIT_MAX_HRYVNIAS)).success).toBe(true);
    expect(parse(String(COD_LIMIT_MIN_HRYVNIAS - 1)).success).toBe(false);
    expect(parse(String(COD_LIMIT_MAX_HRYVNIAS + 1)).success).toBe(false);
  });

  it('rejects an extra zero rather than storing it', () => {
    // The typo the upper bound exists for: 5 000 000 ₴ instead of 500 000 ₴.
    expect(parse('5000000').success).toBe(false);
  });

  it('reports its refusals under one message, so the form has one branch', () => {
    const failed = parse('nope');
    expect(failed.success).toBe(false);
    expect(failed.error!.issues.some((issue) => issue.message === 'invalid_cod_limit')).toBe(true);
  });
});

describe('adminSettingsSchema', () => {
  it('parses the form body the settings page submits', () => {
    expect(adminSettingsSchema.parse({ codLimit: '7500' })).toEqual({ codLimit: 750_000 });
  });

  it('refuses a body with the field missing', () => {
    expect(adminSettingsSchema.safeParse({}).success).toBe(false);
  });
});
