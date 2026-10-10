import { z } from 'zod';
import { PROMO_CODE_PATTERN, campaignCode, normalizePromoCode } from '../orders/promo';
import { cartItemsSchema } from './cart';
import { attributionSchema } from '../attribution';

/**
 * The `/checkout` request, shared by the form's client script and
 * `POST /api/checkout`. Delivery is a discriminated union on `deliveryMethod`
 * because a warehouse/postomat pickup and a courier drop-off need different
 * fields — `orders` still stores them as one flat row (see `schema.ts`), this
 * is just the shape validation is easiest to write against.
 */

/** Also the `maxlength` on the checkout page's name field. */
export const MAX_CUSTOMER_NAME = 100;

/** Also the `maxlength` on the comment textarea. */
export const MAX_COMMENT_LENGTH = 500;

/**
 * Ukrainian mobile numbers only: `0XXXXXXXXX` or `+380XXXXXXXXX`, spaces,
 * dashes and parentheses stripped before matching. Always normalised to
 * `+380XXXXXXXXX` — one canonical form in the database and in what gets sent
 * to Monobank/Telegram later, regardless of how the customer typed it.
 */
const PHONE_PATTERN = /^(?:\+?380|0)(\d{9})$/;

export const customerPhoneSchema = z
  .string()
  .transform((raw) => raw.replace(/[\s()-]/g, ''))
  .refine((value) => PHONE_PATTERN.test(value), 'invalid_phone')
  .transform((value) => `+380${PHONE_PATTERN.exec(value)![1]}`);

/** Optional — an empty string is "not provided", not a validation error. */
export const customerEmailSchema = z
  .union([z.email(), z.literal('')])
  .optional()
  .transform((value) => (value ? value.trim().toLowerCase() : undefined));

const npWarehouseDeliverySchema = z.object({
  deliveryMethod: z.literal('np_warehouse'),
  npSettlementRef: z.string().min(1),
  npSettlementName: z.string().min(1),
  npWarehouseRef: z.string().min(1),
  npWarehouseName: z.string().min(1),
});

const npPostomatDeliverySchema = npWarehouseDeliverySchema.extend({
  deliveryMethod: z.literal('np_postomat'),
});

/**
 * Courier delivery was withdrawn on 2026-08-06: it is no longer offered on
 * `/checkout` or in the admin panel, and a request naming it is rejected here.
 *
 * `delivery_method`'s `np_courier` enum value deliberately stays in the
 * database — orders placed while it was on the menu still have to load and
 * render, in the panel and in the notification formatter. Dropping the value
 * would mean recreating the type and rewriting their delivery method to
 * something the customer never chose.
 */
export const deliverySchema = z.discriminatedUnion('deliveryMethod', [
  npWarehouseDeliverySchema,
  npPostomatDeliverySchema,
]);

export const paymentMethodSchema = z.enum(['card', 'cod', 'parts']);

export const commentSchema = z
  .string()
  .trim()
  .max(MAX_COMMENT_LENGTH)
  .optional()
  .transform((value) => (value ? value : undefined));

/** Optional; normalised to how the code was printed. Empty = no code. */
export const promoCodeSchema = z
  .string()
  .max(40)
  .optional()
  .transform((value) => (value ? normalizePromoCode(value) : undefined))
  .refine(
    (value) => value === undefined || PROMO_CODE_PATTERN.test(value) || campaignCode(value) !== null,
    'invalid_promo',
  );

export const checkoutRequestSchema = z.object({
  customerName: z.string().trim().min(2).max(MAX_CUSTOMER_NAME),
  customerPhone: customerPhoneSchema,
  customerEmail: customerEmailSchema,
  promoCode: promoCodeSchema,
  delivery: deliverySchema,
  paymentMethod: paymentMethodSchema,
  comment: commentSchema,
  items: cartItemsSchema,
  /**
   * Where the buyer came from; optional — a browser without storage sends
   * none. A malformed one is dropped, never a reason to refuse the order.
   */
  attribution: attributionSchema.optional().catch(undefined),
});

export type DeliveryInput = z.infer<typeof deliverySchema>;
