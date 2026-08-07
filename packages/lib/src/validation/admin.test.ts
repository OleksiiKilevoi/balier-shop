import { describe, expect, it } from 'vitest';
import {
  COD_LIMIT_MAX_HRYVNIAS,
  COD_LIMIT_MIN_HRYVNIAS,
  NP_SEAT_CM_MAX,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  adminIssueKey,
  adminNpSettingsSchema,
  adminOrderActionSchema,
  adminOrderEditContactSchema,
  adminOrderEditSchema,
  adminOrderFieldErrors,
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

/**
 * Every input the «Нова Пошта» defaults form renders, blank — which is that
 * form's *normal* first submit, and exactly what has to save cleanly: the
 * plan's one hard requirement for this screen is surviving a half-filled
 * account. The sender refs are no longer typed anywhere — they are fetched
 * from the API by a button with no fields, and the branch comes from
 * `adminNpPlaceSchema`.
 */
const NP_BLANK = {
  phone: '',
  seatLength: '',
  seatWidth: '',
  seatHeight: '',
  cargoDescription: '',
};

function parseNp(overrides: Record<string, string> = {}) {
  return adminNpSettingsSchema.safeParse(body({ ...NP_BLANK, ...overrides }));
}

/** Every input the waybill form renders, as a browser would send it. */
const WAYBILL = {
  intent: 'waybill_create',
  recipientName: 'Тестенко Тест',
  weightGrams: '1250',
  seats: '1',
  seatLength: '30',
  seatWidth: '20',
  seatHeight: '10',
  description: 'Аксесуари зі шкіри',
  declaredValue: '1950',
};

function parseWaybill(overrides: Record<string, string> = {}) {
  return adminOrderActionSchema.safeParse(body({ ...WAYBILL, ...overrides }));
}

describe('adminOrderActionSchema — waybill intents', () => {
  it('parses the form and converts at the boundaries', () => {
    const result = parseWaybill();
    expect(result.success).toBe(true);
    if (result.success && result.data.intent === 'waybill_create') {
      expect(result.data.weightGrams).toBe(1250);
      expect(result.data.seats).toBe(1);
      expect(result.data.seatLength).toBe(30);
      // Hryvnias → kopiykas happens here and nowhere else.
      expect(result.data.declaredValue).toBe(195_000);
    }
  });

  it('refuses a one-word recipient — «Аня» is a real order and not a waybill', () => {
    const result = parseWaybill({ recipientName: 'Аня' });
    expect(result.success).toBe(false);
    expect(
      result.error!.issues.some((issue) => issue.message === 'invalid_recipient_name'),
    ).toBe(true);
  });

  it('refuses zeroes and absurdities where a parcel could not exist', () => {
    expect(parseWaybill({ weightGrams: '0' }).success).toBe(false);
    expect(parseWaybill({ seats: '0' }).success).toBe(false);
    expect(parseWaybill({ seatLength: '0' }).success).toBe(false);
    expect(parseWaybill({ seatLength: '501' }).success).toBe(false);
    expect(parseWaybill({ description: '' }).success).toBe(false);
    expect(parseWaybill({ declaredValue: '0' }).success).toBe(false);
  });

  it('parses the delete intent with no fields at all', () => {
    expect(adminOrderActionSchema.safeParse(body({ intent: 'waybill_delete' })).success).toBe(true);
  });
});

describe('adminNpSettingsSchema', () => {
  it('accepts the whole form blank, as null for every value', () => {
    const result = parseNp();
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      phone: null,
      seatLength: null,
      seatWidth: null,
      seatHeight: null,
      cargoDescription: null,
    });
  });

  it('normalises the phone to +380 from every shape the field can hold', () => {
    // What the masked field actually submits: nine local digits, grouped.
    expect(parseNp({ phone: '98 897 40 64' }).data?.phone).toBe('+380988974064');
    // What a paste or a script-off submit can carry.
    expect(parseNp({ phone: '0988974064' }).data?.phone).toBe('+380988974064');
    expect(parseNp({ phone: '+38 (098) 897-40-64' }).data?.phone).toBe('+380988974064');
    const bad = parseNp({ phone: '12345' });
    expect(bad.success).toBe(false);
    expect(adminIssueKey(bad.error!)).toBe('invalid_np_phone');
  });

  it('takes the seat dimensions whole or not at all', () => {
    const partial = parseNp({ seatLength: '30', seatWidth: '20' });
    expect(partial.success).toBe(false);
    expect(adminIssueKey(partial.error!)).toBe('np_dimensions_incomplete');

    expect(parseNp({ seatLength: '0', seatWidth: '20', seatHeight: '10' }).success).toBe(false);
    expect(
      parseNp({ seatLength: String(NP_SEAT_CM_MAX + 1), seatWidth: '20', seatHeight: '10' })
        .success,
    ).toBe(false);
  });

  it('trims the cargo description and keeps blank as null', () => {
    expect(parseNp({ cargoDescription: '  Аксесуари зі шкіри  ' }).data?.cargoDescription).toBe(
      'Аксесуари зі шкіри',
    );
    expect(parseNp({ cargoDescription: '   ' }).data?.cargoDescription).toBeNull();
    expect(parseNp({ cargoDescription: 'а'.repeat(101) }).success).toBe(false);
  });
});

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
      adminUserActionSchema.safeParse(body({ intent: 'user_impersonate', userId: 'x' })).success,
    ).toBe(false);
  });

  /*
   * Removing an account is three intents rather than one, so that the
   * reversible step and the irreversible one can never be the same request —
   * see `archiveAdminUser` / `purgeAdminUser`.
   */
  it('parses archive and restore from nothing but an id', () => {
    const id = '11111111-1111-4111-8111-111111111111';

    expect(adminUserActionSchema.parse(body({ intent: 'user_archive', userId: id }))).toEqual({
      intent: 'user_archive',
      userId: id,
    });
    expect(adminUserActionSchema.parse(body({ intent: 'user_restore', userId: id }))).toEqual({
      intent: 'user_restore',
      userId: id,
    });
  });

  it('refuses any of the three against an id that is not a uuid', () => {
    for (const intent of ['user_archive', 'user_restore', 'user_purge']) {
      const parsed = adminUserActionSchema.safeParse(
        body({ intent, userId: 'not-a-uuid', email: 'anna@balier.ua' }),
      );

      expect(parsed.success, intent).toBe(false);
      expect(adminIssueKey(parsed.error!), intent).toBe('bad_request');
    }
  });

  it('will not purge without the address typed back', () => {
    const parsed = adminUserActionSchema.safeParse(
      body({ intent: 'user_purge', userId: '11111111-1111-4111-8111-111111111111', email: '  ' }),
    );

    expect(parsed.success).toBe(false);
    expect(adminIssueKey(parsed.error!)).toBe('confirm_email');
  });

  it('trims the typed-back address, since the row it is matched against is normalised', () => {
    const id = '11111111-1111-4111-8111-111111111111';

    expect(
      adminUserActionSchema.parse(
        body({ intent: 'user_purge', userId: id, email: '  Anna@Balier.UA ' }),
      ),
    ).toEqual({ intent: 'user_purge', userId: id, email: 'Anna@Balier.UA' });
  });
});

/**
 * `/orders/[n]/edit`'s save. Unlike the schemas above, its input is not a raw
 * form body — the page composes it: the contact fields from the draft (with
 * `+380` restored ahead of the digits, as `/orders/new` does) and `delivery`
 * from the refs *resolved against the database*, so what is tested here is
 * that composed shape. The field names still match what the form renders —
 * they are `DRAFT_FIELDS`' targets, shared with `/orders/new`.
 */
describe('adminOrderEditSchema', () => {
  const delivery = {
    deliveryMethod: 'np_warehouse',
    npSettlementRef: 'ref-city',
    npSettlementName: 'Київ',
    npWarehouseRef: 'ref-wh',
    npWarehouseName: 'Відділення №1',
  };

  it('normalises the phone and lower-cases the email, like checkout does', () => {
    const parsed = adminOrderEditSchema.parse({
      customerName: '  Анна Коваль ',
      customerPhone: '+380 50 123 45 67',
      customerEmail: 'Anna@Balier.UA',
      delivery,
    });

    expect(parsed.customerName).toBe('Анна Коваль');
    expect(parsed.customerPhone).toBe('+380501234567');
    expect(parsed.customerEmail).toBe('anna@balier.ua');
  });

  it('treats an emptied email as cleared, not as an error', () => {
    // The page maps the resulting `undefined` to NULL — emptying the box is
    // how a wrongly-recorded address is removed from the order.
    const parsed = adminOrderEditSchema.parse({
      customerName: 'Анна Коваль',
      customerPhone: '0501234567',
      customerEmail: '',
      delivery,
    });
    expect(parsed.customerEmail).toBeUndefined();
  });

  it('maps a missing branch to the warehouse control, an un-picked city to the settlement one', () => {
    const refused = adminOrderEditSchema.safeParse({
      customerName: 'Анна Коваль',
      customerPhone: '0501234567',
      customerEmail: '',
      delivery: { ...delivery, npWarehouseRef: '', npWarehouseName: '' },
    });
    expect(refused.success).toBe(false);
    expect(adminOrderFieldErrors(refused.error!)).toEqual(new Set(['warehouse']));

    const unpicked = adminOrderEditSchema.safeParse({
      customerName: 'Анна Коваль',
      customerPhone: '0501234567',
      customerEmail: '',
      delivery: {
        deliveryMethod: 'np_warehouse',
        npSettlementRef: '',
        npSettlementName: '',
        npWarehouseRef: '',
        npWarehouseName: '',
      },
    });
    expect(unpicked.success).toBe(false);
    expect(adminOrderFieldErrors(unpicked.error!).has('settlement')).toBe(true);
  });

  it('has a contact-only variant that asks nothing about delivery', () => {
    // The legacy-courier save: the stored street address stays as placed, so
    // the schema must not force a branch pick on a phone-number fix.
    const parsed = adminOrderEditContactSchema.parse({
      customerName: 'Анна Коваль',
      customerPhone: '380501234567',
      customerEmail: '',
    });
    expect(parsed).toEqual({ customerName: 'Анна Коваль', customerPhone: '+380501234567' });
  });
});
