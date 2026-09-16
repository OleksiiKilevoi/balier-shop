import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { getPlatformProxy } from 'wrangler';
import * as schema from '@balier/lib/db/schema';
import { storeImage } from '@balier/lib/media';
import { hryvnias } from '@balier/lib/money';
import { LAUNCH_CATEGORIES, LAUNCH_PRODUCTS } from './launch-catalog';

/**
 * One-off: loads `launch-catalog.ts` into whatever `DATABASE_URL` is in the
 * root `.dev.vars`, and its photos into the real `balier-media` bucket through
 * the same `storeImage` the panel's upload route uses (`getPlatformProxy` with
 * remote bindings — needs `wrangler login`).
 *
 * Photos come from `CATALOG_PHOTOS` (default `~/Downloads/balier`), are
 * resized to 1440 px on the long side as JPEG by `sips` (macOS — it reads
 * HEIC, and cannot write WebP), cached under the system temp dir.
 *
 * Idempotent per product: a slug that already exists is skipped whole, so a
 * re-run after a crash finishes the rest and never duplicates images.
 * `DRY_RUN=1` only resolves the photo names and exits.
 */

loadEnv({ path: '.dev.vars', quiet: true });
loadEnv({ quiet: true });

const run = promisify(execFile);
const PHOTOS = process.env.CATALOG_PHOTOS ?? path.join(os.homedir(), 'Downloads', 'balier');
const CACHE = path.join(os.tmpdir(), 'balier-catalog-1440');
const LONG_SIDE = '1440';
const JPEG_QUALITY = '80';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set in .dev.vars');

  // 1. Resolve every stem to exactly one file before touching anything.
  const files = await readdir(PHOTOS);
  const resolve = (stem: string): string => {
    const hits = files.filter((f) => f.startsWith(stem) && /^[.~]/.test(f.slice(stem.length)));
    if (hits.length !== 1) throw new Error(`${stem}: ${hits.length} matches (${hits.join(', ')})`);
    return path.join(PHOTOS, hits[0]!);
  };
  const allStems = LAUNCH_PRODUCTS.flatMap((p) => [
    ...p.photos,
    ...p.variants.flatMap((v) => v.photos ?? []),
  ]);
  const sources = new Map(allStems.map((s) => [s, resolve(s)]));
  console.log(`${LAUNCH_PRODUCTS.length} products, ${sources.size} distinct photos resolved.`);
  if (process.env.DRY_RUN) return;

  // 2. Resize into the cache (skip what is already there).
  await mkdir(CACHE, { recursive: true });
  const prepared = new Map<string, string>();
  for (const [stem, source] of sources) {
    const out = path.join(CACHE, `${stem}.jpg`);
    const exists = await stat(out).then(() => true, () => false);
    if (!exists) {
      await run('sips', ['-Z', LONG_SIDE, '-s', 'format', 'jpeg', '-s', 'formatOptions', JPEG_QUALITY, source, '--out', out]);
    }
    prepared.set(stem, out);
  }
  console.log(`Resized into ${CACHE}.`);

  // 3. Upload + insert.
  const db = drizzle(neon(databaseUrl), { schema });
  const { env, dispose } = await getPlatformProxy<{ MEDIA: R2Bucket; IMAGES: ImagesBinding }>({
    configPath: 'apps/admin/wrangler.jsonc',
    remoteBindings: true,
  });

  try {
    const categoryIds = new Map<string, string>();
    for (const c of LAUNCH_CATEGORIES) {
      const [row] = await db
        .insert(schema.categories)
        .values({ slug: c.slug, position: c.position, isActive: true })
        .onConflictDoNothing()
        .returning();
      const id =
        row?.id ??
        (await db.query.categories.findFirst({ where: (t, { eq }) => eq(t.slug, c.slug) }))?.id;
      if (!id) throw new Error(`category ${c.slug}`);
      await db
        .insert(schema.categoryTranslations)
        .values({ categoryId: id, locale: 'uk', title: c.title })
        .onConflictDoNothing();
      categoryIds.set(c.slug, id);
    }

    const uploaded = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
    const upload = async (stem: string) => {
      const hit = uploaded.get(stem);
      if (hit) return hit;
      const bytes = await readFile(prepared.get(stem)!);
      const stored = await storeImage(
        { bucket: env.MEDIA, images: env.IMAGES },
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        `${stem}.jpg`,
      );
      uploaded.set(stem, stored);
      return stored;
    };

    for (const [i, p] of LAUNCH_PRODUCTS.entries()) {
      // Photos first: a crash here leaves no half-made product behind, and a
      // re-run finds every object already in the bucket (content-addressed).
      for (const stem of [...p.photos, ...p.variants.flatMap((v) => v.photos ?? [])]) await upload(stem);

      const [product] = await db
        .insert(schema.products)
        .values({
          slug: p.slug,
          categoryId: categoryIds.get(p.categorySlug)!,
          basePrice: hryvnias(p.priceUah),
          status: 'active',
          isFeatured: p.isFeatured ?? false,
          position: i + 1,
        })
        .onConflictDoNothing()
        .returning();
      if (!product) {
        console.log(`  ${p.slug}: exists, skipped`);
        continue;
      }
      await db.insert(schema.productTranslations).values({
        productId: product.id,
        locale: 'uk',
        title: p.title,
        description: p.description,
        details: p.details,
      });

      let position = 0;
      const images: (typeof schema.productImages.$inferInsert)[] = [];
      for (const stem of p.photos) {
        const s = await upload(stem);
        images.push({ productId: product.id, url: s.url, alt: p.title, width: s.width, height: s.height, position: position++ });
      }
      for (const [vi, v] of p.variants.entries()) {
        const [variant] = await db
          .insert(schema.productVariants)
          .values({ productId: product.id, sku: v.sku, colorName: v.colorName, colorHex: v.colorHex, position: vi + 1 })
          .returning();
        for (const stem of v.photos ?? []) {
          const s = await upload(stem);
          images.push({ productId: product.id, variantId: variant!.id, url: s.url, alt: `${p.title} — ${v.colorName}`, width: s.width, height: s.height, position: position++ });
        }
      }
      if (images.length) await db.insert(schema.productImages).values(images);
      console.log(`  ${p.slug}: ${p.variants.length} variant(s), ${images.length} image(s)`);
    }
    console.log(`\nDone. ${uploaded.size} objects stored.`);
  } finally {
    await dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
