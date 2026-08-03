import { config as loadEnv } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../src/lib/db/schema';
import { hryvnias } from '../src/lib/money';

loadEnv({ path: '.dev.vars', quiet: true });
loadEnv({ quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .dev.vars.example to .dev.vars first.');
  process.exit(1);
}

const db = drizzle(neon(databaseUrl), { schema });

/**
 * Development data only. Safe to re-run: every insert is keyed on a natural
 * unique column and does nothing on conflict.
 */
async function seed() {
  console.log('Seeding categories…');
  const [bags] = await db
    .insert(schema.categories)
    .values({ slug: 'bags', position: 1 })
    .onConflictDoNothing()
    .returning();

  const categoryId =
    bags?.id ??
    (await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.slug, 'bags') }))?.id;

  if (!categoryId) throw new Error('Could not resolve the seeded category');

  await db
    .insert(schema.categoryTranslations)
    .values({ categoryId, locale: 'uk', title: 'Сумки' })
    .onConflictDoNothing();

  console.log('Seeding products…');

  // A product with no variations — exactly one variant, colorName = null.
  const [tote] = await db
    .insert(schema.products)
    .values({
      slug: 'tote-classic',
      categoryId,
      basePrice: hryvnias(1850),
      status: 'active',
      isFeatured: true,
    })
    .onConflictDoNothing()
    .returning();

  if (tote) {
    await db
      .insert(schema.productTranslations)
      .values({
        productId: tote.id,
        locale: 'uk',
        title: 'Шопер Classic',
        description: 'Місткий шопер із щільної бавовни. Підходить для ноутбука 15".',
      })
      .onConflictDoNothing();

    await db
      .insert(schema.productVariants)
      .values({ productId: tote.id, sku: 'TOTE-CLASSIC', stock: 12, isActive: true })
      .onConflictDoNothing();
  }

  // A product that does come in several colours.
  const [crossbody] = await db
    .insert(schema.products)
    .values({
      slug: 'crossbody-mini',
      categoryId,
      basePrice: hryvnias(2400),
      compareAtPrice: hryvnias(2900),
      status: 'active',
      isFeatured: true,
    })
    .onConflictDoNothing()
    .returning();

  if (crossbody) {
    await db
      .insert(schema.productTranslations)
      .values({
        productId: crossbody.id,
        locale: 'uk',
        title: 'Кросбоді Mini',
        description: 'Компактна сумка на кожен день. Знімний ремінь, підкладка з бавовни.',
      })
      .onConflictDoNothing();

    await db
      .insert(schema.productVariants)
      .values([
        {
          productId: crossbody.id,
          sku: 'CROSS-MINI-BLK',
          colorName: 'Чорний',
          colorHex: '#1a1a1c',
          stock: 5,
          position: 1,
        },
        {
          productId: crossbody.id,
          sku: 'CROSS-MINI-BEI',
          colorName: 'Бежевий',
          colorHex: '#d9cbb8',
          stock: 3,
          position: 2,
        },
        {
          productId: crossbody.id,
          sku: 'CROSS-MINI-BRN',
          colorName: 'Коричневий',
          colorHex: '#6b4a32',
          stock: 0,
          position: 3,
        },
      ])
      .onConflictDoNothing();
  }

  console.log('Seeding settings…');
  await db
    .insert(schema.settings)
    .values([
      // Kopiykas. Orders above this cannot use cash on delivery.
      { key: 'cod_limit', value: hryvnias(5000) },
      // Minutes a stock reservation is held for an unpaid order.
      { key: 'reservation_ttl_minutes', value: 30 },
    ])
    .onConflictDoNothing();

  console.log('Done.');
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
