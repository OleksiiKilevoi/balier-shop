import { describe, expect, it } from 'vitest';
import { parseReviewForm } from './review';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('parseReviewForm', () => {
  it('keeps rated products, skips unrated ones, ignores foreign ids', () => {
    const result = parseReviewForm(
      {
        authorName: '  Олена ',
        [`rating:${A}`]: '5',
        [`body:${A}`]: '  Чудова сумка  ',
        [`rating:${B}`]: '',
        'rating:ffffffff-0000-4000-8000-000000000009': '1',
      },
      [A, B],
    );
    expect(result).toEqual({
      ok: true,
      authorName: 'Олена',
      entries: [{ productId: A, rating: 5, body: 'Чудова сумка' }],
    });
  });

  it('stores an empty text as null', () => {
    const result = parseReviewForm({ authorName: 'Ян', [`rating:${A}`]: '4', [`body:${A}`]: ' ' }, [A]);
    expect(result.ok && result.entries[0]?.body).toBeNull();
  });

  it('refuses a bad name, an out-of-range rating, text without stars, and nothing rated', () => {
    expect(parseReviewForm({ authorName: 'Я', [`rating:${A}`]: '5' }, [A])).toEqual({ ok: false, error: 'invalid_name' });
    expect(parseReviewForm({ authorName: 'Олена', [`rating:${A}`]: '6' }, [A])).toEqual({ ok: false, error: 'invalid_review' });
    expect(parseReviewForm({ authorName: 'Олена', [`body:${A}`]: 'текст' }, [A])).toEqual({ ok: false, error: 'invalid_review' });
    expect(parseReviewForm({ authorName: 'Олена' }, [A])).toEqual({ ok: false, error: 'nothing_rated' });
  });
});
