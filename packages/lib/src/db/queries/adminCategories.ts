import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db, TxDb } from '../index';
import { categories, categoryTranslations, products } from '../schema';
import { LOCALE } from './locale';
import { uniqueConstraint } from './unique';

/**
 * Categories, from the panel.
 *
 * Small on purpose: a category is a slug, a title, an order and a switch. It
 * exists so the product form has something to point at, and so the client can
 * add «Рюкзаки» without a deploy — not as a second content system.
 *
 * There is no delete here either, for a reason the products table does not
 * share: `products.category_id` is `ON DELETE set null`, so removing a category
 * would silently empty the category field of every product in it, with nothing
 * on screen to undo. Deactivating is the reversible version of the same intent —
 * `getProductBySlug` keeps the pill's text and drops its link, and the products
 * themselves stay exactly where they are.
 */

export interface AdminCategoryRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  position: number;
  isActive: boolean;
  /** Products pointing here, whatever their status. */
  productCount: number;
}

export async function listAdminCategories(db: Db): Promise<AdminCategoryRow[]> {
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      title: categoryTranslations.title,
      description: categoryTranslations.description,
      position: categories.position,
      isActive: categories.isActive,
      productCount: sql<number>`count(${products.id})::int`,
    })
    .from(categories)
    .innerJoin(
      categoryTranslations,
      and(
        eq(categoryTranslations.categoryId, categories.id),
        eq(categoryTranslations.locale, LOCALE),
      ),
    )
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(
      categories.id,
      categoryTranslations.title,
      categoryTranslations.description,
    )
    .orderBy(asc(categories.position), asc(categoryTranslations.title));
}

export interface CategoryFields {
  slug: string;
  title: string;
  description: string | null;
  position: number;
  isActive: boolean;
}

export type CategoryResult = { ok: true } | { ok: false; reason: 'slug_taken' | 'not_found' };

function slugTaken(error: unknown): boolean {
  const constraint = uniqueConstraint(error);
  return constraint !== null && constraint.includes('slug');
}

export async function createCategory(
  db: TxDb,
  fields: CategoryFields,
): Promise<CategoryResult> {
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(categories)
        .values({ slug: fields.slug, position: fields.position, isActive: fields.isActive })
        .returning({ id: categories.id });

      await tx.insert(categoryTranslations).values({
        categoryId: created!.id,
        locale: LOCALE,
        title: fields.title,
        description: fields.description,
      });
    });

    return { ok: true };
  } catch (error) {
    if (slugTaken(error)) return { ok: false, reason: 'slug_taken' };
    throw error;
  }
}

export async function updateCategory(
  db: TxDb,
  categoryId: string,
  fields: CategoryFields,
): Promise<CategoryResult> {
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(categories)
        .set({
          slug: fields.slug,
          position: fields.position,
          isActive: fields.isActive,
          updatedAt: new Date(),
        })
        .where(eq(categories.id, categoryId))
        .returning({ id: categories.id });

      if (updated.length === 0) return { ok: false, reason: 'not_found' } satisfies CategoryResult;

      // Upsert for the same reason the product translation is one: the seed
      // wrote translations with `onConflictDoNothing`.
      await tx
        .insert(categoryTranslations)
        .values({
          categoryId,
          locale: LOCALE,
          title: fields.title,
          description: fields.description,
        })
        .onConflictDoUpdate({
          target: [categoryTranslations.categoryId, categoryTranslations.locale],
          set: { title: fields.title, description: fields.description },
        });

      return { ok: true } satisfies CategoryResult;
    });
  } catch (error) {
    if (slugTaken(error)) return { ok: false, reason: 'slug_taken' };
    throw error;
  }
}
