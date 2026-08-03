import { and, eq } from 'drizzle-orm';
import type { Db } from '../index';
import { categories, categoryTranslations } from '../schema';
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
