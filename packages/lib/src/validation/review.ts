import { z } from 'zod';
import type { NewReview } from '../db/queries/reviews';

export const REVIEW_NAME_MAX = 60;
export const REVIEW_BODY_MAX = 2000;

const nameSchema = z.string().trim().min(2).max(REVIEW_NAME_MAX);
const ratingSchema = z.coerce.number().int().min(1).max(5);
const bodySchema = z
  .string()
  .trim()
  .max(REVIEW_BODY_MAX)
  .transform((value) => value || null);

export type ReviewFormError = 'invalid_name' | 'invalid_review' | 'nothing_rated';

/**
 * The `/review/<token>` form: one name, then `rating:<productId>` and
 * `body:<productId>` per product. Only the products the order actually holds
 * (and not yet reviewed) are read — anything else in the body is ignored. A
 * product left without stars is skipped, not an error: people review what
 * they want to.
 */
export function parseReviewForm(
  fields: Record<string, unknown>,
  productIds: string[],
): { ok: true; authorName: string; entries: NewReview[] } | { ok: false; error: ReviewFormError } {
  const name = nameSchema.safeParse(fields.authorName ?? '');
  if (!name.success) return { ok: false, error: 'invalid_name' };

  const entries: NewReview[] = [];
  for (const productId of productIds) {
    const rawRating = fields[`rating:${productId}`];
    const rawBody = fields[`body:${productId}`] ?? '';
    if (rawRating === undefined || rawRating === '') {
      if (typeof rawBody === 'string' && rawBody.trim()) return { ok: false, error: 'invalid_review' };
      continue;
    }
    const rating = ratingSchema.safeParse(rawRating);
    const body = bodySchema.safeParse(rawBody);
    if (!rating.success || !body.success) return { ok: false, error: 'invalid_review' };
    entries.push({ productId, rating: rating.data, body: body.data });
  }

  if (entries.length === 0) return { ok: false, error: 'nothing_rated' };
  return { ok: true, authorName: name.data, entries };
}
