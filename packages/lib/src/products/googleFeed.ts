import type { FeedVariantData } from '../db/queries/products';
import { variantLabel } from './variant';

/**
 * The Merchant Center feed (RSS 2.0 + `g:` namespace), one item per variant so
 * each colour shows with its own photo and stock. Own brand, no GTINs —
 * `identifier_exists: no` says so instead of leaving Google to flag it.
 */
const BRAND = 'BÁLIER';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function feedItem(variant: FeedVariantData, origin: string): string {
  const label = variantLabel(variant.colorName, variant.size);
  const title = label ? `${variant.title} — ${label}` : variant.title;
  const fields: [string, string | null][] = [
    ['g:id', variant.sku],
    ['g:item_group_id', variant.productId],
    ['g:title', title],
    // Google requires a description; the title is better than a rejected item.
    ['g:description', variant.description?.trim() || title],
    ['g:link', `${origin}/products/${variant.slug}`],
    ['g:image_link', variant.imageUrl ? new URL(variant.imageUrl, origin).href : null],
    ['g:price', `${(variant.price / 100).toFixed(2)} UAH`],
    ['g:availability', variant.inStock ? 'in_stock' : 'out_of_stock'],
    ['g:condition', 'new'],
    ['g:brand', BRAND],
    ['g:identifier_exists', 'no'],
    ['g:color', variant.colorName],
    ['g:size', variant.size],
  ];
  const lines = fields.flatMap(([tag, value]) =>
    value === null ? [] : [`    <${tag}>${escapeXml(value)}</${tag}>`],
  );
  return `  <item>\n${lines.join('\n')}\n  </item>`;
}

export function googleFeed(variants: FeedVariantData[], origin: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>${BRAND}</title>
  <link>${origin}</link>
  <description>${BRAND} — шкіряні сумки та аксесуари</description>
${variants.map((variant) => feedItem(variant, origin)).join('\n')}
</channel>
</rss>
`;
}
