import { z } from 'zod';
import { adminRole, orderStatus, parcelSize } from '../db/schema';
import { splitRecipientName } from '../novaposhta/waybill';
import { phoneDigitsFromInput } from '../phone';
import { cartItemsSchema } from './cart';
import {
  MAX_CUSTOMER_NAME,
  commentSchema,
  customerEmailSchema,
  customerPhoneSchema,
  deliverySchema,
  paymentMethodSchema,
} from './checkout';
import { wholeHryvniaSchema } from './money';

/**
 * What the order detail page can POST to itself — status moves and the two
 * waybill actions. Everything arrives as an HTML form body rather than JSON —
 * the panel is server-rendered and works with no script at all — so everything
 * here starts as a string.
 */

const orderStatusSchema = z.enum(orderStatus.enumValues);

/**
 * The login form. Deliberately loose: this is the *shape* check, not the
 * credential check, and a rejection here must not tell an attacker anything a
 * wrong password would not. So there is no "email looks wrong" branch and no
 * minimum length — an address that cannot exist and a password that is too
 * short both simply fail to match a row, with the same message and the same
 * timing as any other wrong guess.
 *
 * The maximum exists for a different reason: PBKDF2 hashes whatever it is
 * handed, so an unbounded field is an unbounded amount of Worker CPU per POST.
 */
export const PASSWORD_MAX_LENGTH = 200;

export const adminLoginSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type AdminLogin = z.infer<typeof adminLoginSchema>;

/**
 * `/login/telegram`, both steps — the same deliberate looseness as
 * `adminLoginSchema`, and for the same reason: these are shape checks, and a
 * rejection must not say anything a wrong code would not. The code's `\d{6}`
 * is not policy, just the one shape `generateOtpCode` ever produces; anything
 * else can only be wrong, and fails with the same message.
 */
export const adminOtpRequestSchema = z.object({
  email: z.string().trim().min(1).max(320),
});

export const adminOtpVerifySchema = z.object({
  email: z.string().trim().min(1).max(320),
  code: z
    .string()
    .trim()
    .refine((value) => /^\d{6}$/.test(value)),
});

/* ------------------------------------------------------------- the waybill */

/**
 * Bounds for «Створити ТТН». Typo guards in the COD-limit tradition — they
 * catch an extra zero and an empty field, not what Nova Poshta will actually
 * carry; the carrier's own refusal is authoritative and is shown verbatim.
 */
export const WAYBILL_SEATS_MAX = 99;
export const WAYBILL_DECLARED_MIN_HRYVNIAS = 1;
export const WAYBILL_DECLARED_MAX_HRYVNIAS = 1_000_000;
export const NP_CARGO_DESCRIPTION_MAX = 100;

function waybillWholeNumber(min: number, max: number, error: string) {
  return z
    .string()
    .transform((raw) => raw.replace(/[\s '’]/g, ''))
    .refine((value) => /^\d+$/.test(value), error)
    .transform(Number)
    .refine((value) => value >= min && value <= max, error);
}

/**
 * The waybill form. Weight, seats, dimensions, description and declared value
 * are the operator's to confirm; the recipient's phone and destination are
 * deliberately absent — they render read-only from the order, and a body that
 * could override them would mean shipping somewhere the customer did not ask.
 *
 * The name *is* here: it is the one recipient field an order can hold in an
 * unusable form («Аня» passes checkout), so the operator may fix it — for the
 * waybill only, never written back to the order.
 */
const waybillCreateSchema = z.object({
  intent: z.literal('waybill_create'),
  recipientName: z
    .string()
    .trim()
    .max(MAX_CUSTOMER_NAME, 'invalid_recipient_name')
    .refine((value) => splitRecipientName(value) !== null, 'invalid_recipient_name'),
  /** Which box — its weight and dimensions come from `PARCEL_SIZES`. */
  parcelSize: z.enum(parcelSize.enumValues, 'invalid_parcel_size'),
  seats: waybillWholeNumber(1, WAYBILL_SEATS_MAX, 'invalid_seats'),
  description: z
    .string()
    .trim()
    .min(1, 'invalid_waybill_description')
    .max(NP_CARGO_DESCRIPTION_MAX, 'invalid_waybill_description'),
  declaredValue: wholeHryvniaSchema({
    min: WAYBILL_DECLARED_MIN_HRYVNIAS,
    max: WAYBILL_DECLARED_MAX_HRYVNIAS,
    error: 'invalid_declared_value',
  }),
});

export type WaybillCreateInput = z.infer<typeof waybillCreateSchema>;

export const adminOrderActionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('status'),
    /**
     * The status the page was *rendered* from. Checked against the live row
     * before anything moves, so a stale tab — or a second click on a button the
     * operator already used — cannot fire a transition nobody chose to make.
     */
    from: orderStatusSchema,
    next: orderStatusSchema,
  }),
  waybillCreateSchema,
  z.object({ intent: z.literal('waybill_delete') }),
]);

export type AdminOrderAction = z.infer<typeof adminOrderActionSchema>;

/* ------------------------------------------------- register of shipments --- */

/**
 * One carrier call carries the whole batch, so the ceiling is a typo guard
 * against a hand-composed body, not a business rule — a real handover is a
 * dozen parcels, and the create form can only offer what one page lists.
 */
export const REGISTER_ORDERS_MAX = 100;

/** Order numbers are `B######-#####`; anything longer is a tampered body. */
const registerOrderNumberSchema = z.string().trim().min(1).max(40);

/**
 * «Створити реєстр» — the selection posted from `/orders`. The page builds
 * `orders` from `formData.getAll()`, so it arrives as a real array; everything
 * about *which* orders qualify is checked against live rows, not here.
 */
export const adminRegisterCreateSchema = z.object({
  intent: z.literal('register_create'),
  orders: z
    .array(registerOrderNumberSchema)
    .min(1, 'register_no_selection')
    .max(REGISTER_ORDERS_MAX, 'register_no_selection'),
});

export type AdminRegisterCreate = z.infer<typeof adminRegisterCreateSchema>;

/** What one register's own page can POST to itself. */
export const adminRegisterActionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('register_remove_order'),
    orderNumber: registerOrderNumberSchema,
  }),
  z.object({ intent: z.literal('register_delete') }),
]);

export type AdminRegisterAction = z.infer<typeof adminRegisterActionSchema>;

/**
 * The cash-on-delivery limit, as `/admin/settings` submits it.
 *
 * The form is in hryvnias and the setting is in kopiykas; `wholeHryvniaSchema`
 * is where that conversion happens, for this field and for every price on the
 * catalog screens. The rules used to be written out here, and moved to
 * `./money` once a second money field needed exactly the same ones.
 *
 * The bounds are typo guards, not policy: they exist to catch an empty field
 * and an extra zero, not to express what Nova Poshta will actually carry
 * cash-on-delivery — that is a real-world ceiling the panel does not know and
 * must not pretend to. Note that the minimum is *not* an off switch either;
 * setting the limit to 1 ₴ would refuse cash on delivery for every real order,
 * which is why the screen says out loud that it cannot disable the method.
 */
export const COD_LIMIT_MIN_HRYVNIAS = 1;
export const COD_LIMIT_MAX_HRYVNIAS = 1_000_000;

export const codLimitSchema = wholeHryvniaSchema({
  min: COD_LIMIT_MIN_HRYVNIAS,
  max: COD_LIMIT_MAX_HRYVNIAS,
  error: 'invalid_cod_limit',
});

export const adminSettingsSchema = z.object({ codLimit: codLimitSchema });

/** The e-mail promo section of `/settings`: on/off and the percentage. */
export const PROMO_PERCENT_MIN = 1;
export const PROMO_PERCENT_MAX = 90;

export const adminPromoSchema = z.object({
  enabled: z
    .string()
    .optional()
    .transform((value) => value === 'on'),
  percent: z
    .string()
    .transform((raw) => raw.trim())
    .refine((value) => /^\d+$/.test(value), 'invalid_promo_percent')
    .transform(Number)
    .refine((value) => value >= PROMO_PERCENT_MIN && value <= PROMO_PERCENT_MAX, 'invalid_promo_percent'),
});

export type AdminSettings = z.infer<typeof adminSettingsSchema>;

/* --------------------------------------------------- nova poshta sender ----- */

/**
 * The «Нова Пошта» section of `/settings` — the sender behind every waybill.
 *
 * Three forms, three schemas (or none): the account identity is *fetched* from
 * the API by a button with no fields at all — its refs exist nowhere an admin
 * could copy them from — the handover branch is picked by name and number
 * (`adminNpPlaceSchema`), and only the defaults below are typed in directly.
 *
 * Every typed field may be blank, and blank means NULL rather than an error:
 * the plan is explicit that this screen has to survive being half-filled,
 * because the panel is in use long before the client's account exists, and the
 * waybill form is the place that refuses on a missing value, naming it.
 */

/**
 * The masked phone field: the visible input holds the 9 local digits after the
 * fixed `+380` prefix, exactly as on `/checkout` and `/admin/orders/new` —
 * `phoneDigitsFromInput` also swallows a pasted `0…`/`380…`/`+380…`, so the
 * mask script is a convenience, never a requirement.
 */
const optionalNpPhone = z
  .string()
  .transform((raw) => phoneDigitsFromInput(raw))
  .refine((digits) => digits === '' || digits.length === 9, 'invalid_np_phone')
  .transform((digits): string | null => (digits === '' ? null : `+380${digits}`));

export const adminNpSettingsSchema = z.object({
  phone: optionalNpPhone,
  cargoDescription: z
    .string()
    .transform((raw) => raw.trim())
    .refine((value) => value.length <= NP_CARGO_DESCRIPTION_MAX, 'invalid_np_description')
    .transform((value): string | null => (value === '' ? null : value)),
});

export type AdminNpSettings = z.infer<typeof adminNpSettingsSchema>;

/*
 * The branch picker deliberately has no schema: it is a draft flow in the
 * `/admin/orders/new` mould — queries render suggestion lists, a suggestion
 * row's own submit value is the choice — and its refs are validated by the
 * database lookups that resolve them, not by shape.
 */

/* ------------------------------------------------------- passwords and roles */

/**
 * The floor for a password somebody *chooses*, as opposed to one they are
 * merely proving they already know (`adminLoginSchema`, which has no minimum on
 * purpose — see above).
 *
 * Twelve, matching `scripts/admin-user.ts`, which imports this rather than
 * keeping its own number: the script and the panel write rows into the same
 * column, and a rule only one of them enforces is not a rule. It carries more
 * weight than it looks: the Workers runtime caps PBKDF2 at 100 000 iterations
 * (`~/auth/password`), so length is the half of the trade still ours to set.
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * A password being set, wherever it is set from. The maximum is
 * `adminLoginSchema`'s and exists for the same reason — PBKDF2 hashes whatever
 * it is handed — so a password that passes here can always be logged in with.
 */
const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'password_too_short')
  .max(PASSWORD_MAX_LENGTH, 'password_too_long');

export const adminRoleSchema = z.enum(adminRole.enumValues);

/**
 * «Зміна пароля» on `/settings`, which every signed-in user gets for their own
 * account — role has nothing to do with it.
 *
 * The current password is required and is checked against the stored hash by
 * the page, not here: a session cookie is not proof that the person typing is
 * the person who signed in, and without this field a borrowed laptop is a
 * permanent account takeover.
 *
 * The second refinement is not pedantry. Re-submitting the same password reads
 * as a successful change while nothing about the account has changed, which is
 * exactly the wrong thing to tell somebody who is changing it because they
 * think it leaked.
 */
export const adminPasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'bad_request').max(PASSWORD_MAX_LENGTH, 'bad_request'),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().max(PASSWORD_MAX_LENGTH),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'passwords_do_not_match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'password_unchanged',
    path: ['newPassword'],
  });

export type AdminPasswordChange = z.infer<typeof adminPasswordChangeSchema>;

/**
 * `/users` — admin-only, and the role is re-read from the database on every one
 * of these, never taken from the session cookie (`users.astro`).
 *
 * The address is validated here, unlike at login: a typo in a *new* account is
 * an account nobody can ever sign into, and the person who would find out is
 * not the person making the mistake. It is lower-cased by `normalizeEmail` in
 * the query layer, which is the only writer of the column.
 *
 * Removal is three intents rather than one, because it is deliberately two
 * decisions: `user_archive` takes the account out of the list and is undone by
 * `user_restore`, and `user_purge` — reachable only from the archive tab, and
 * refused by `purgeAdminUser` for anything not already in it — is the one that
 * drops the row. Nothing about the shape of these bodies enforces that order;
 * the query layer does, since a body is whatever somebody chooses to send.
 */
export const adminUserActionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('user_create'),
    email: z.email('invalid_email').max(320, 'invalid_email'),
    name: z
      .string()
      .trim()
      .max(120)
      .transform((value): string | null => (value === '' ? null : value)),
    role: adminRoleSchema,
    password: newPasswordSchema,
  }),
  z.object({
    intent: z.literal('user_save'),
    userId: z.uuid('bad_request'),
    role: adminRoleSchema,
    /** An unchecked checkbox is an absent key, never `false`. */
    isActive: z
      .string()
      .optional()
      .transform((value) => value === 'on'),
  }),
  z.object({
    intent: z.literal('user_password'),
    userId: z.uuid('bad_request'),
    password: newPasswordSchema,
  }),
  z.object({
    intent: z.literal('user_archive'),
    userId: z.uuid('bad_request'),
  }),
  z.object({
    intent: z.literal('user_restore'),
    userId: z.uuid('bad_request'),
  }),
  z.object({
    intent: z.literal('user_purge'),
    userId: z.uuid('bad_request'),
    /**
     * The address as the archive tab rendered it, typed back by the operator.
     * Not a security control — anyone posting by hand supplies whatever this
     * says — but the last irreversible step in the panel should take more than
     * a click landing on the wrong row, and typing the address is the one
     * confirmation that cannot be given absent-mindedly. `purgeAdminUser` is
     * handed it and refuses if the row's real address differs.
     */
    email: z.string().trim().min(1, 'confirm_email').max(320, 'confirm_email'),
  }),
]);

export type AdminUserAction = z.infer<typeof adminUserActionSchema>;

/**
 * The one message a rejected password or user form is shown as.
 *
 * These screens have a single banner, so the *first* issue is the answer — and
 * the schemas above name their own issues (`password_too_short`,
 * `passwords_do_not_match`, …) so that the key is chosen where the rule is
 * written rather than inferred from a path later. Anything unrecognised comes
 * back as `bad_request`, which is what an operator can act on when the form
 * failed for a reason no field explains.
 */
export function adminIssueKey(error: z.ZodError): string {
  const [issue] = error.issues;
  return issue ? issue.message : 'bad_request';
}

/**
 * An order placed by a manager at `/admin/orders/new`.
 *
 * Every field is the storefront's own rule, imported rather than restated:
 * the phone is normalised to `+380XXXXXXXXX` by the same transform, the
 * delivery union is the same discriminated union, and the basket is the same
 * `cartItemsSchema`. A manager typing an order out of a Telegram message must
 * not be able to create one the checkout form could not — the difference
 * between the two paths is who is holding the keyboard, not what an order is.
 *
 * The one addition is `.min(1)` on the items: `/api/checkout` rejects an empty
 * cart with its own branch before validating, and here the basket is part of
 * the same form, so it belongs in the same check.
 */
export const adminNewOrderSchema = z.object({
  customerName: z.string().trim().min(2).max(MAX_CUSTOMER_NAME),
  customerPhone: customerPhoneSchema,
  customerEmail: customerEmailSchema,
  delivery: deliverySchema,
  paymentMethod: paymentMethodSchema,
  comment: commentSchema,
  items: cartItemsSchema.min(1),
});

export type AdminNewOrder = z.infer<typeof adminNewOrderSchema>;

/**
 * `/orders/[n]/edit` — the same customer whose order it already is, corrected.
 *
 * Deliberately `adminNewOrderSchema` minus the parts an edit must not touch:
 * no items, no payment method, no comment — the goods and the money are the
 * order, these fields are only who it is for and where it goes. The contact
 * variant exists for legacy courier orders, whose stored delivery stays as
 * placed unless the operator actually picks a branch (the page decides which
 * schema applies; `updateOrderDetails` applies whichever subset it is handed).
 */
export const adminOrderEditSchema = z.object({
  customerName: z.string().trim().min(2).max(MAX_CUSTOMER_NAME),
  customerPhone: customerPhoneSchema,
  customerEmail: customerEmailSchema,
  delivery: deliverySchema,
});

export const adminOrderEditContactSchema = adminOrderEditSchema.omit({ delivery: true });

export type AdminOrderEdit = z.infer<typeof adminOrderEditSchema>;

/** Where a rejection is shown on the form. */
export type AdminOrderField =
  | 'customerName'
  | 'customerPhone'
  | 'customerEmail'
  | 'settlement'
  | 'warehouse'
  | 'items';

/**
 * Sorts Zod's issues into the fields the form actually renders.
 *
 * The delivery union is the awkward part: a missing settlement and a missing
 * branch both fail as `delivery`, and each one needs its message under a
 * different control — so the issue's *path* decides, and anything unrecognised
 * falls back to the settlement, which is the first step of that section and the
 * one that gates the rest.
 */
export function adminOrderFieldErrors(error: z.ZodError): Set<AdminOrderField> {
  const fields = new Set<AdminOrderField>();

  for (const issue of error.issues) {
    const [head, next] = issue.path;

    switch (head) {
      case 'customerName':
      case 'customerPhone':
      case 'customerEmail':
      case 'items':
        fields.add(head);
        break;
      case 'delivery':
        if (next === 'npWarehouseRef' || next === 'npWarehouseName') fields.add('warehouse');
        else fields.add('settlement');
        break;
      default:
        // `paymentMethod` and `comment` cannot fail from the form's own
        // controls — a radio and a length-capped textarea — so there is nowhere
        // to put a message and nothing a manager could do about it.
        break;
    }
  }

  return fields;
}
