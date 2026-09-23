import { describe, expect, it } from 'vitest';
import { legacyRedirect } from './legacyRedirects';

describe('legacyRedirect', () => {
  it('sends the old content pages to their successors', () => {
    expect(legacyRedirect('/o-nas.html')).toBe('/about');
    expect(legacyRedirect('/publichnaya-oferta.html')).toBe('/offer');
    expect(legacyRedirect('/obratnaya-svyaz.html')).toBe('/contacts');
    expect(legacyRedirect('/news/rss/')).toBe('/');
  });

  it('sends old shop URLs to the nearest category, else the catalog', () => {
    expect(legacyRedirect('/shop/ryukzaki/muzhskie.html')).toBe('/products/category/backpacks-travel');
    expect(legacyRedirect('/shop/finansydokumenty/portmone/300.html')).toBe('/products/category/wallets');
    expect(legacyRedirect('/shop/portfel/portfel-muzhskoy.html')).toBe('/products/category/mens-bags');
    expect(legacyRedirect('/shop/drugoe/fartuk.html')).toBe('/products');
    expect(legacyRedirect('/shop/cart/done.html')).toBe('/products');
  });

  it('follows the old language prefix to the same places', () => {
    // Exactly what Google still holds — checked against the index 2026-09-23.
    expect(legacyRedirect('/ru/shop/sumki/zhenskie/zhenskaya-bolshaya-sumka-less-chyornaya.html')).toBe(
      '/products/category/womens-bags',
    );
    expect(legacyRedirect('/ru/o-nas.html')).toBe('/about');
    expect(legacyRedirect('/ru/shop/aksessuary/klyuchnitsy.html')).toBe('/products');
    expect(legacyRedirect('/ru/')).toBe('/');
    expect(legacyRedirect('/ru')).toBe('/');
    // The bare root is the live home page, not a redirect to itself.
    expect(legacyRedirect('/')).toBeNull();
  });

  it('knows nothing about the new site or random paths', () => {
    expect(legacyRedirect('/products/sumka-lunet')).toBeNull();
    expect(legacyRedirect('/about')).toBeNull();
    expect(legacyRedirect('/wp-admin')).toBeNull();
  });
});
