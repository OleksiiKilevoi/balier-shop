import { z } from 'zod';
import { orderStatus } from '~/lib/db/schema';

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
