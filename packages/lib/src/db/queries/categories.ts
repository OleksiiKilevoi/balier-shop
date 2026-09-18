import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { categories, categoryTranslations, products } from '../schema';
import { LOCALE } from './locale';

/** Everything the category page's header renders. */
export interface CategoryData {
  id: string;
  slug: string;
  title: string;
  description: string | null;
}

/**
 * One category page. Returns null for an unknown slug, a deactivated category,
 * or one with no Ukrainian translation — all three must 404 rather than render
 * a heading-less page.
 */
export async function getCategoryBySlug(db: Db, slug: string): Promise<CategoryData | null> {
  const [row] = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      title: categoryTranslations.title,
      description: categoryTranslations.description,
    })
    .from(categories)
    .innerJoin(
      categoryTranslations,
      and(
        eq(categoryTranslations.categoryId, categories.id),
        eq(categoryTranslations.locale, LOCALE),
      ),
    )
    .where(and(eq(categories.slug, slug), eq(categories.isActive, true)))
    .limit(1);

  return row ?? null;
}

/** One entry of the category nav on `/products` and the category pages. */
export interface CategoryNavItem {
  slug: string;
  title: string;
  /** Active products only — the number the category page will actually show. */
  productCount: number;
}

/**
 * The category nav: active, translated categories in panel order, each with
 * its count of active products. Categories with nothing to show are left out —
 * a link to an empty grid is a dead end, and the panel's `is_active` flag
 * already exists for hiding one on purpose.
 */
export async function listActiveCategories(db: Db): Promise<CategoryNavItem[]> {
  const productCount = sql<number>`count(${products.id})::int`;

  return db
    .select({
      slug: categories.slug,
      title: categoryTranslations.title,
      productCount,
    })
    .from(categories)
    .innerJoin(
      categoryTranslations,
      and(
        eq(categoryTranslations.categoryId, categories.id),
        eq(categoryTranslations.locale, LOCALE),
      ),
    )
    .leftJoin(products, and(eq(products.categoryId, categories.id), eq(products.status, 'active')))
    .where(eq(categories.isActive, true))
    .groupBy(categories.id, categoryTranslations.title)
    .having(sql`count(${products.id}) > 0`)
    .orderBy(asc(categories.position));
}
