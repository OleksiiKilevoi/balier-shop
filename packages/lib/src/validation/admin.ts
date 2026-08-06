import { z } from 'zod';
import { adminRole, orderStatus } from '../db/schema';
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
 * The two things the order detail page can POST to itself. Both arrive as an
 * HTML form body rather than JSON — the panel is server-rendered and works with
 * no script at all — so everything here starts as a string.
 */

const orderStatusSchema = z.enum(orderStatus.enumValues);

/**
 * Nova Poshta's «Експрес-накладна» number: 14 digits, usually written in groups
 * of four. Spaces and dashes are stripped rather than rejected, since that is
 * how the number is printed and how it lands on the clipboard.
 *
 * An empty value is not an error — it clears a tracking number that was typed
 * wrong, which is otherwise impossible.
 */
export const TRACKING_NUMBER_LENGTH = 14;

export const trackingNumberSchema = z
  .string()
  .transform((raw) => raw.replace(/[\s-]/g, ''))
  .refine(
    (value) => value === '' || new RegExp(`^\\d{${TRACKING_NUMBER_LENGTH}}$`).test(value),
    'invalid_tracking_number',
  )
  .transform((value) => (value === '' ? null : value));

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
  z.object({
    intent: z.literal('ttn'),
    ttn: trackingNumberSchema,
  }),
]);

export type AdminOrderAction = z.infer<typeof adminOrderActionSchema>;

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

export type AdminSettings = z.infer<typeof adminSettingsSchema>;

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
