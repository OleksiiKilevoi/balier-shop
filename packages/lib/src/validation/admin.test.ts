import { describe, expect, it } from 'vitest';
import {
  COD_LIMIT_MAX_HRYVNIAS,
  COD_LIMIT_MIN_HRYVNIAS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  adminIssueKey,
  adminPasswordChangeSchema,
  adminSettingsSchema,
  adminUserActionSchema,
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

/**
 * The account schemas, checked against **bodies built from a real `FormData`**
 * rather than from hand-written objects.
 *
 * That is the lesson image upload cost three sessions: `curl -F` and an object
 * literal will both happily carry a field no control on the page renders, so a
 * schema can pass its whole test file and still refuse every real submit. An
 * unchecked checkbox is an absent key, a `<select>` always sends something, and
 * a password field sends `''` when it is left empty — these bodies behave that
 * way because they are one.
 */
function body(fields: Record<string, string>): Record<string, unknown> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return Object.fromEntries(form);
}

const GOOD_PASSWORD = 'correct horse battery';

describe('adminPasswordChangeSchema', () => {
  const change = (fields: Record<string, string>) =>
    adminPasswordChangeSchema.safeParse(
      body({
        currentPassword: 'old password here',
        newPassword: GOOD_PASSWORD,
        confirmPassword: GOOD_PASSWORD,
        ...fields,
      }),
    );

  it('accepts the body the section submits', () => {
    expect(change({}).success).toBe(true);
  });

  it('names its own refusal, so the page maps one key to one sentence', () => {
    expect(adminIssueKey(change({ newPassword: 'short', confirmPassword: 'short' }).error!)).toBe(
      'password_too_short',
    );
    expect(adminIssueKey(change({ confirmPassword: 'something else entirely' }).error!)).toBe(
      'passwords_do_not_match',
    );
  });

  it('refuses a "new" password identical to the current one', () => {
    // A no-op that reports success is the wrong thing to tell somebody who is
    // changing their password because they think it leaked.
    const same = change({ currentPassword: GOOD_PASSWORD });
    expect(same.success).toBe(false);
    expect(adminIssueKey(same.error!)).toBe('password_unchanged');
  });

  it('requires the current password — a session alone is not proof of identity', () => {
    // What an empty field actually sends, which is why this is not `{}`.
    expect(change({ currentPassword: '' }).success).toBe(false);
  });

  it('caps the length, since PBKDF2 hashes whatever it is handed', () => {
    const long = 'x'.repeat(PASSWORD_MAX_LENGTH + 1);
    expect(adminIssueKey(change({ newPassword: long, confirmPassword: long }).error!)).toBe(
      'password_too_long',
    );
  });

  it('accepts a password of exactly the minimum length', () => {
    const exact = 'a'.repeat(PASSWORD_MIN_LENGTH);
    expect(change({ newPassword: exact, confirmPassword: exact }).success).toBe(true);
  });
});

describe('adminUserActionSchema', () => {
  it('parses the create form, and blank name means NULL rather than empty', () => {
    const parsed = adminUserActionSchema.parse(
      body({
        intent: 'user_create',
        email: 'Anna@Balier.UA',
        name: '  ',
        role: 'manager',
        password: GOOD_PASSWORD,
      }),
    );

    expect(parsed).toEqual({
      intent: 'user_create',
      // Lower-casing is `normalizeEmail`'s job in the query layer — the only
      // writer of the column — so the schema leaves the address as typed.
      email: 'Anna@Balier.UA',
      name: null,
      role: 'manager',
      password: GOOD_PASSWORD,
    });
  });

  it('refuses an address that could never receive a password', () => {
    const parsed = adminUserActionSchema.safeParse(
      body({ intent: 'user_create', email: 'anna@', name: '', role: 'admin', password: GOOD_PASSWORD }),
    );

    expect(parsed.success).toBe(false);
    expect(adminIssueKey(parsed.error!)).toBe('invalid_email');
  });

  it('refuses a role that is not one of the two', () => {
    expect(
      adminUserActionSchema.safeParse(
        body({
          intent: 'user_create',
          email: 'anna@balier.ua',
          name: '',
          role: 'owner',
          password: GOOD_PASSWORD,
        }),
      ).success,
    ).toBe(false);
  });

  it('reads an unchecked "Активний" as off — an absent key, not a false one', () => {
    const id = '11111111-1111-4111-8111-111111111111';

    expect(
      adminUserActionSchema.parse(body({ intent: 'user_save', userId: id, role: 'admin' })),
    ).toEqual({ intent: 'user_save', userId: id, role: 'admin', isActive: false });

    expect(
      adminUserActionSchema.parse(
        body({ intent: 'user_save', userId: id, role: 'admin', isActive: 'on' }),
      ),
    ).toEqual({ intent: 'user_save', userId: id, role: 'admin', isActive: true });
  });

  it('holds the reset form to the same length rule as every other password', () => {
    const parsed = adminUserActionSchema.safeParse(
      body({
        intent: 'user_password',
        userId: '11111111-1111-4111-8111-111111111111',
        password: 'short',
      }),
    );

    expect(parsed.success).toBe(false);
    expect(adminIssueKey(parsed.error!)).toBe('password_too_short');
  });

  it('refuses an intent the page does not render', () => {
    expect(
      adminUserActionSchema.safeParse(body({ intent: 'user_delete', userId: 'x' })).success,
    ).toBe(false);
  });
});
