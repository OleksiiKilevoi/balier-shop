/**
 * Development catalog, transcribed from the `desc.txt` in each `test-products`
 * folder — the real Instagram captions for three BÁLIER products.
 *
 * Shared by `ingest-images.ts` (which needs the folder names) and `seed.ts`
 * (which needs everything else), so the two cannot disagree about what a product
 * is. Not production content: Phase 5 fills the real catalog through the admin
 * panel.
 */

export interface TestCategory {
  slug: string;
  title: string;
  position: number;
}

export interface TestProduct {
  /** Directory under `test-products/`. */
  folder: string;
  slug: string;
  sku: string;
  title: string;
  description: string;
  /** Rendered as a bullet list on the product page. One per line. */
  details?: string;
  dimensions: string;
  /** Whole hryvnias, exactly as written on the card. Converted at insert time. */
  priceUah: number;
  stock: number;
  categorySlug: string;
  isFeatured: boolean;
}

export const TEST_CATEGORIES: TestCategory[] = [
  { slug: 'womens-bags', title: 'Жіночі сумки', position: 1 },
  { slug: 'mens-bags', title: 'Чоловічі сумки', position: 2 },
  { slug: 'wallets', title: 'Гаманці', position: 3 },
];

export const TEST_PRODUCTS: TestProduct[] = [
  {
    folder: '1',
    slug: 'lunet',
    sku: 'LUNET',
    title: 'Сумка Lunet',
    description:
      'Вмістка сумка, що тримає форму та доповнює образ. Усередині — одна кишеня на змійці та дві відкриті кишені.',
    details: 'Тримає форму\nДоповнює образ\nПідійде під багато образів',
    dimensions: '30х17х10 см',
    priceUah: 5500,
    stock: 4,
    categorySlug: 'womens-bags',
    isFeatured: true,
  },
  {
    folder: '2',
    slug: 'space',
    sku: 'SPACE',
    title: 'Нагрудна сумка Space',
    description: 'Нагрудна сумка, що підійде під багато образів, включно з класикою.',
    dimensions: '25х15х6 см',
    priceUah: 4800,
    stock: 6,
    categorySlug: 'mens-bags',
    isFeatured: true,
  },
  {
    folder: '3',
    slug: 'wallet',
    sku: 'WALLET',
    title: 'Гаманець BÁLIER',
    description:
      'Максимально охайний, вмісткий та зручний гаманець. Усередині шкіряний підклад, аби купюри було зручно використовувати. Відділ на змійці з розширенням.',
    dimensions: '19х11 см',
    priceUah: 1950,
    stock: 9,
    categorySlug: 'wallets',
    isFeatured: true,
  },
];

/** Where `ingest-images.ts` writes what it uploaded, and `seed.ts` reads it. */
export const MANIFEST_PATH = 'test-products/.manifest.json';

export interface ManifestEntry {
  /** Site-relative, straight into `product_images.url`. */
  url: string;
  width: number | null;
  height: number | null;
}

/** Keyed by `<folder>/<filename>`, e.g. `1/3.webp`. */
export type MediaManifest = Record<string, ManifestEntry>;
