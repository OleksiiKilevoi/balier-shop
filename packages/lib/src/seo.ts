/**
 * `<title>` and meta-description shaping for the storefront's `BaseLayout`.
 *
 * Both limits are where Google cuts the text off in a result, not hard rules —
 * past them the snippet ends mid-word with Google's own ellipsis. Product titles
 * and descriptions are typed by the owner in the panel, so the layout shapes
 * them on the way out instead of the form rejecting them.
 */

const BRAND = 'Balier';
const SUFFIX = ` — ${BRAND}`;
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

/** Lowercased with accents stripped, so `BÁLIER` and `Balier` compare equal. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The page title with ` — Balier` appended, unless the title already names the
 * brand or the suffix would push it past {@link TITLE_MAX}. A long product name
 * is worth more in the result than the brand Google would truncate anyway.
 */
export function pageTitle(title: string): string {
  if (fold(title).includes(fold(BRAND))) return title;
  if (title.length + SUFFIX.length > TITLE_MAX) return title;
  return `${title}${SUFFIX}`;
}

/**
 * A description cut to {@link DESCRIPTION_MAX}: at the last sentence end that
 * fits, or — when the first sentence alone is too long — at a word boundary
 * with an ellipsis. A sentence end in the first third is skipped, since a
 * description of one short clause says less than a cut-off longer one.
 */
export function clampDescription(text: string | null | undefined): string | undefined {
  const clean = text?.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  if (clean.length <= DESCRIPTION_MAX) return clean;

  const head = clean.slice(0, DESCRIPTION_MAX + 1);
  const sentenceEnd = Math.max(...[...head.matchAll(/[.!?…](?=\s)/g)].map((m) => m.index));
  if (sentenceEnd >= DESCRIPTION_MAX / 3) return clean.slice(0, sentenceEnd + 1);

  const wordEnd = clean.lastIndexOf(' ', DESCRIPTION_MAX - 1);
  return `${clean.slice(0, wordEnd).replace(/[\s,;:—–-]+$/, '')}…`;
}

/** One link in a breadcrumb trail; `path` is site-relative. */
export interface Crumb {
  name: string;
  path: string;
}

/**
 * Structured data for a product listing (`/products`, a category): the page as
 * a `CollectionPage` whose main entity is the ordered list of product URLs, and
 * the breadcrumb trail Google can show in place of the URL. The products are
 * listed by URL only — their own pages carry the full `Product` markup, and
 * Google reads a summary list as exactly that.
 */
export function collectionPageJsonLd(options: {
  origin: string;
  name: string;
  description?: string;
  /** Home first, this page last. */
  crumbs: readonly Crumb[];
  products: readonly { slug: string; title: string }[];
}): object[] {
  const { origin, name, description, crumbs, products } = options;
  const url = `${origin}${crumbs.at(-1)?.path ?? '/'}`;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name,
      url,
      ...(description ? { description } : {}),
      inLanguage: 'uk',
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: products.length,
        itemListElement: products.map((product, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${origin}/products/${product.slug}`,
          name: product.title,
        })),
      },
    },
    breadcrumbJsonLd(origin, crumbs),
  ];
}

/** A `BreadcrumbList` for the trail a page shows, home first. */
export function breadcrumbJsonLd(origin: string, crumbs: readonly Crumb[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: `${origin}${crumb.path}`,
    })),
  };
}
