import { readFile } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import * as schema from '@balier/lib/db/schema';
import { hryvnias } from '@balier/lib/money';
import {
  MANIFEST_PATH,
  TEST_CATEGORIES,
  TEST_PRODUCTS,
  type MediaManifest,
} from './test-catalog';

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
      .values({ productId: tote.id, sku: 'TOTE-CLASSIC', isActive: true })
      .onConflictDoNothing();
  }

  // A product that does come in several colours.
  const [crossbody] = await db
    .insert(schema.products)
    .values({
      slug: 'crossbody-mini',
      categoryId,
      basePrice: hryvnias(2400),
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
          position: 1,
        },
        {
          productId: crossbody.id,
          sku: 'CROSS-MINI-BEI',
          colorName: 'Бежевий',
          colorHex: '#d9cbb8',
          position: 2,
        },
        {
          productId: crossbody.id,
          sku: 'CROSS-MINI-BRN',
          colorName: 'Коричневий',
          colorHex: '#6b4a32',
          // The one seeded colour that is sold out, so every screen that has
          // to render «немає в наявності» has something to render it for.
          inStock: false,
          position: 3,
        },
      ])
      .onConflictDoNothing();
  }

  await seedTestProducts();

  console.log('Seeding settings…');
  await db
    .insert(schema.settings)
    .values([
      // Kopiykas. Orders above this cannot use cash on delivery.
      { key: 'cod_limit', value: hryvnias(5000) },
      // Minutes an unpaid card order stays payable before the cron sweeps it.
      { key: 'payment_ttl_minutes', value: 30 },
    ])
    .onConflictDoNothing();

  console.log('Done.');
}

/**
 * The three products actually photographed for the store, with the imagery that
 * `pnpm media:ingest` put in R2. Run that first — without a manifest the
 * products still seed, they just render the "Фото незабаром" placeholder.
 *
 * The synthetic products above are kept on purpose: between them they cover the
 * two paths the real three do not — a product with several colour variants, and
 * a product with no photography at all.
 */
async function seedTestProducts() {
  const manifest = await readManifest();
  if (!manifest) {
    console.warn(`  no ${MANIFEST_PATH} — run \`pnpm media:ingest\` to attach images`);
  }

  console.log('Seeding photographed test products…');

  const categoryIds = new Map<string, string>();
  for (const category of TEST_CATEGORIES) {
    const [inserted] = await db
      .insert(schema.categories)
      .values({ slug: category.slug, position: category.position, isActive: true })
      .onConflictDoNothing()
      .returning();

    const id =
      inserted?.id ??
      (await db.query.categories.findFirst({ where: (c, { eq: is }) => is(c.slug, category.slug) }))
        ?.id;
    if (!id) throw new Error(`Could not resolve category ${category.slug}`);

    await db
      .insert(schema.categoryTranslations)
      .values({ categoryId: id, locale: 'uk', title: category.title })
      .onConflictDoNothing();

    categoryIds.set(category.slug, id);
  }

  for (const product of TEST_PRODUCTS) {
    const categoryId = categoryIds.get(product.categorySlug);
    if (!categoryId) throw new Error(`Unknown category ${product.categorySlug}`);

    const [inserted] = await db
      .insert(schema.products)
      .values({
        slug: product.slug,
        categoryId,
        basePrice: hryvnias(product.priceUah),
        dimensions: product.dimensions,
        status: 'active',
        isFeatured: product.isFeatured,
      })
      .onConflictDoNothing()
      .returning();

    const productId =
      inserted?.id ??
      (await db.query.products.findFirst({ where: (p, { eq: is }) => is(p.slug, product.slug) }))
        ?.id;
    if (!productId) throw new Error(`Could not resolve product ${product.slug}`);

    await db
      .insert(schema.productTranslations)
      .values({
        productId,
        locale: 'uk',
        title: product.title,
        description: product.description,
        details: product.details ?? null,
      })
      .onConflictDoNothing();

    // One variant, no colour choice — the selector stays hidden. Still a row:
    // availability, SKU and every cart/order reference hang off the variant.
    await db
      .insert(schema.productVariants)
      .values({ productId, sku: product.sku, isActive: true })
      .onConflictDoNothing();

    if (!manifest) continue;

    const images = Object.entries(manifest)
      .filter(([key]) => key.startsWith(`${product.folder}/`))
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));

    // `product_images` has no natural unique column, so replace rather than
    // upsert — otherwise re-running the seed stacks duplicate galleries.
    await db.delete(schema.productImages).where(eq(schema.productImages.productId, productId));

    if (images.length > 0) {
      await db.insert(schema.productImages).values(
        images.map(([, entry], index) => ({
          productId,
          // NULL: shared by every variant. These products have only one anyway.
          variantId: null,
          url: entry.url,
          alt: product.title,
          width: entry.width,
          height: entry.height,
          position: index,
        })),
      );
    }

    console.log(`  ${product.slug}: ${images.length} image(s)`);
  }
}

async function readManifest(): Promise<MediaManifest | null> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as MediaManifest;
  } catch {
    return null;
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
