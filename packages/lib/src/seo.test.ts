import { describe, expect, it } from 'vitest';
import { clampDescription, collectionPageJsonLd, pageTitle } from './seo';

describe('pageTitle', () => {
  it('appends the brand to a short title', () => {
    expect(pageTitle('Догляд за шкірою')).toBe('Догляд за шкірою — Balier');
  });

  it('leaves the bare brand alone', () => {
    expect(pageTitle('Balier')).toBe('Balier');
  });

  it('does not repeat a brand the title already names, accent or not', () => {
    expect(pageTitle('Шкіряна сумка кросбоді BÁLIER')).toBe('Шкіряна сумка кросбоді BÁLIER');
    expect(pageTitle('Ремінь ручної роботи BALIER')).toBe('Ремінь ручної роботи BALIER');
  });

  it('drops the suffix when it would push the title past 60 characters', () => {
    const title = 'Шкіряний фартух, фартух для кухаря, фартух для барбекю'; // 54
    expect(pageTitle(title)).toBe(title);
  });

  it('keeps the suffix when the result fits exactly', () => {
    const title = 'а'.repeat(60 - ' — Balier'.length);
    expect(pageTitle(title)).toHaveLength(60);
  });
});

describe('clampDescription', () => {
  it('returns undefined for nothing', () => {
    expect(clampDescription(undefined)).toBeUndefined();
    expect(clampDescription('   ')).toBeUndefined();
  });

  it('passes a short description through, whitespace collapsed', () => {
    expect(clampDescription('  Шкіряні   вироби.\n Доставка. ')).toBe('Шкіряні вироби. Доставка.');
  });

  it('cuts at the last sentence end that fits', () => {
    const first = 'Жіночі шкіряні сумки ручної роботи від BÁLIER, які шиємо в майстерні у Дніпрі.'; // 79
    const second = 'Колір можна обрати з палітри, а доставка Новою Поштою йде по всій Україні.'; // 75
    const third = 'Третє речення, яке вже точно не влазить у сто шістдесят символів опису сторінки.';
    expect(clampDescription(`${first} ${second} ${third}`)).toBe(`${first} ${second}`);
  });

  it('falls back to a word boundary with an ellipsis when no sentence end fits', () => {
    const text = `${'слово '.repeat(40).trim()}.`;
    const clamped = clampDescription(text)!;
    expect(clamped.length).toBeLessThanOrEqual(160);
    expect(clamped.endsWith('слово…')).toBe(true);
  });

  it('ignores a sentence end so early it would leave a stub', () => {
    const text = `Так. ${'довге речення без крапки '.repeat(10)}`;
    expect(clampDescription(text)!.startsWith('Так. довге')).toBe(true);
  });
});

describe('collectionPageJsonLd', () => {
  const [page, breadcrumbs] = collectionPageJsonLd({
    origin: 'https://balier.com.ua',
    name: 'Жіночі сумки',
    crumbs: [
      { name: 'Головна', path: '/' },
      { name: 'Товари', path: '/products' },
      { name: 'Жіночі сумки', path: '/products/category/womens-bags' },
    ],
    products: [
      { slug: 'shoper', title: 'Шопер' },
      { slug: 'sumka-lunet', title: 'Lunet' },
    ],
  }) as [Record<string, any>, Record<string, any>];

  it('names the page by its own URL, the last crumb', () => {
    expect(page.url).toBe('https://balier.com.ua/products/category/womens-bags');
    expect(page).not.toHaveProperty('description');
  });

  it('lists the products in grid order with absolute URLs', () => {
    expect(page.mainEntity.numberOfItems).toBe(2);
    expect(page.mainEntity.itemListElement[1]).toEqual({
      '@type': 'ListItem',
      position: 2,
      url: 'https://balier.com.ua/products/sumka-lunet',
      name: 'Lunet',
    });
  });

  it('numbers the breadcrumbs from 1', () => {
    expect(breadcrumbs.itemListElement.map((c: { position: number; item: string }) => [c.position, c.item])).toEqual([
      [1, 'https://balier.com.ua/'],
      [2, 'https://balier.com.ua/products'],
      [3, 'https://balier.com.ua/products/category/womens-bags'],
    ]);
  });
});
