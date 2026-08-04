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
