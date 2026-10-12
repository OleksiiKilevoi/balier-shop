import { describe, expect, it } from 'vitest';
import { cardImageUrl, cardSourceKey } from './card';

describe('cardImageUrl', () => {
  it('points our photos at the card-sized copy', () => {
    expect(cardImageUrl('/media/50627cf62f8864e0.webp')).toBe('/media/w640/50627cf62f8864e0.webp');
    expect(cardImageUrl('/media/0b96d37eddae81f9.jpg')).toBe('/media/w640/0b96d37eddae81f9.jpg');
  });

  it('leaves anything that is not one of our photos alone', () => {
    expect(cardImageUrl('/images/hero.jpg')).toBe('/images/hero.jpg');
    expect(cardImageUrl('https://example.com/a.webp')).toBe('https://example.com/a.webp');
    expect(cardImageUrl(null)).toBeNull();
  });
});

describe('cardSourceKey', () => {
  it('maps the copy back to the original object', () => {
    expect(cardSourceKey('w640/50627cf62f8864e0.webp')).toBe('50627cf62f8864e0.webp');
  });

  it('refuses anything outside the closed set', () => {
    expect(cardSourceKey('50627cf62f8864e0.webp')).toBeNull();
    expect(cardSourceKey('w320/50627cf62f8864e0.webp')).toBeNull();
    expect(cardSourceKey('w640/../secret.webp')).toBeNull();
    expect(cardSourceKey('w640/50627cf62f8864e0.exe')).toBeNull();
    expect(cardSourceKey('w640/a/50627cf62f8864e0.webp')).toBeNull();
  });
});
