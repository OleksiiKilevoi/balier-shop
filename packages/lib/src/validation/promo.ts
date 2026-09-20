import { z } from 'zod';

/** `POST /api/promo/subscribe` — one field, the address the code goes to. */
export const promoSubscribeSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .transform((value) => value.toLowerCase())
    .pipe(z.email()),
});
