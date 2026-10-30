import { describe, expect, it } from 'vitest';
import { leadImages } from './feedImage';

const images = [
  { productId: 'p1', variantId: 'brown-13', url: '/media/brown-a.webp' },
  { productId: 'p1', variantId: 'brown-13', url: '/media/brown-b.webp' },
  { productId: 'p1', variantId: 'black-13', url: '/media/black.webp' },
  { productId: 'p2', variantId: null, url: '/media/p2-lead.webp' },
];

const variants = [
  { variantId: 'brown-13', productId: 'p1', colorName: 'Коричневий' },
  { variantId: 'brown-16', productId: 'p1', colorName: 'Коричневий' },
  { variantId: 'black-13', productId: 'p1', colorName: 'Чорний' },
  { variantId: 'green-13', productId: 'p1', colorName: 'Зелений' },
  { variantId: 'p2-only', productId: 'p2', colorName: null },
];

describe('leadImages', () => {
  const lead = leadImages(variants, images);

  it('gives a variant its own first photo', () => {
    expect(lead.get('brown-13')).toBe('/media/brown-a.webp');
  });

  it('lets a size without photos borrow the photos of its colour, as the product page does', () => {
    expect(lead.get('brown-16')).toBe('/media/brown-a.webp');
  });

  it('falls back to the product-level photo', () => {
    expect(lead.get('p2-only')).toBe('/media/p2-lead.webp');
  });

  it('falls back to any photo of the product before giving up', () => {
    expect(lead.get('green-13')).toBe('/media/brown-a.webp');
  });
});
