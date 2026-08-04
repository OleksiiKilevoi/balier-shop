import { z } from 'zod';
import { cartItemsSchema } from './cart';

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

/** Also the `maxlength`/`minlength` on the courier street-address field. */
export const MIN_ADDRESS_LENGTH = 5;
export const MAX_ADDRESS_LENGTH = 200;

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

const npCourierDeliverySchema = z.object({
  deliveryMethod: z.literal('np_courier'),
  npSettlementRef: z.string().min(1),
  npSettlementName: z.string().min(1),
  npAddress: z.string().trim().min(MIN_ADDRESS_LENGTH).max(MAX_ADDRESS_LENGTH),
});

export const deliverySchema = z.discriminatedUnion('deliveryMethod', [
  npWarehouseDeliverySchema,
  npPostomatDeliverySchema,
  npCourierDeliverySchema,
]);

export const paymentMethodSchema = z.enum(['card', 'cod']);

export const commentSchema = z
  .string()
  .trim()
  .max(MAX_COMMENT_LENGTH)
  .optional()
  .transform((value) => (value ? value : undefined));

export const checkoutRequestSchema = z.object({
  customerName: z.string().trim().min(2).max(MAX_CUSTOMER_NAME),
  customerPhone: customerPhoneSchema,
  customerEmail: customerEmailSchema,
  delivery: deliverySchema,
  paymentMethod: paymentMethodSchema,
  comment: commentSchema,
  items: cartItemsSchema,
  turnstileToken: z.string().min(1),
});

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export type DeliveryInput = z.infer<typeof deliverySchema>;
