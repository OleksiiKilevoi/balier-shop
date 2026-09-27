import { describe, expect, it } from 'vitest';
import type { FeedVariantData } from '../db/queries/products';
import { feedItem } from './googleFeed';

const variant: FeedVariantData = {
  sku: 'BAG-01-BLK',
  productId: 'p1',
  slug: 'tote',
  title: 'Tote <mini> & co',
  description: null,
  colorName: 'Чорний',
  size: null,
  price: 420_050,
  inStock: false,
  imageUrl: '/media/tote.jpg',
};

describe('feedItem', () => {
  it('formats price, availability, absolute URLs and escapes text', () => {
    const xml = feedItem(variant, 'https://balier.com.ua');
    expect(xml).toContain('<g:price>4200.50 UAH</g:price>');
    expect(xml).toContain('<g:availability>out_of_stock</g:availability>');
    expect(xml).toContain('<g:image_link>https://balier.com.ua/media/tote.jpg</g:image_link>');
    expect(xml).toContain('<g:title>Tote &lt;mini&gt; &amp; co — Чорний</g:title>');
    expect(xml).toContain('<g:description>Tote &lt;mini&gt; &amp; co — Чорний</g:description>');
  });

  it('drops empty optional fields', () => {
    const xml = feedItem({ ...variant, colorName: null, imageUrl: null }, 'https://x.ua');
    expect(xml).not.toContain('g:color');
    expect(xml).not.toContain('g:image_link');
  });
});
