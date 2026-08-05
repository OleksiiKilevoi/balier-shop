import { z } from 'zod';
import { orderStatus } from '~/lib/db/schema';
import { cartItemsSchema } from './cart';
import {
  MAX_CUSTOMER_NAME,
  commentSchema,
  customerEmailSchema,
  customerPhoneSchema,
  deliverySchema,
  paymentMethodSchema,
} from './checkout';

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
  | 'address'
  | 'items';

/**
 * Sorts Zod's issues into the fields the form actually renders.
 *
 * The delivery union is the awkward part: a missing settlement, a missing
 * branch and a too-short courier address all fail as `delivery`, and each one
 * needs its message under a different control — so the issue's *path* decides,
 * and anything unrecognised falls back to the settlement, which is the first
 * step of that section and the one that gates the rest.
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
        if (next === 'npAddress') fields.add('address');
        else if (next === 'npWarehouseRef' || next === 'npWarehouseName') fields.add('warehouse');
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
