import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../index';
import type { ReviewStatus } from '../schema';
import { orderItems, orders, productTranslations, productVariants, products, reviews } from '../schema';
import { LOCALE } from './locale';

/**
 * Product reviews. The way in is an order's review link (`/review/<token>`),
 * which only opens for a `delivered` order — so every review is from a buyer.
 * Everything lands `pending`; the panel's «Відгуки» publishes or rejects.
 */

/** One product the customer can still review, or already has. */
export interface ReviewInviteProduct {
  productId: string;
  slug: string;
  /**
   * The catalog's current name and address, not the order's snapshot: a
   * product renamed since the purchase still has one page, and the review
   * shows on it.
   */
  title: string;
  reviewed: boolean;
}

export interface ReviewInvite {
  orderId: string;
  orderNumber: string;
  customerName: string;
  products: ReviewInviteProduct[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The order behind a review link, if the link is real and the parcel was
 * received. A malformed token is answered here rather than by Postgres
 * throwing on the uuid cast.
 */
export async function findReviewInvite(db: Db, token: string): Promise<ReviewInvite | null> {
  if (!UUID.test(token)) return null;

  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, customerName: orders.customerName })
    .from(orders)
    .where(and(eq(orders.reviewToken, token), eq(orders.status, 'delivered')))
    .limit(1);
  if (!order) return null;

  const rows = await db
    .selectDistinctOn([productVariants.productId], {
      productId: productVariants.productId,
      slug: products.slug,
      title: productTranslations.title,
      reviewed: sql<boolean>`${reviews.id} is not null`,
    })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
    )
    .leftJoin(
      reviews,
      and(eq(reviews.orderId, orderItems.orderId), eq(reviews.productId, productVariants.productId)),
    )
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(productVariants.productId));

  return { orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName, products: rows };
}

export interface NewReview {
  productId: string;
  rating: number;
  body: string | null;
}

/**
 * Saves what was submitted. A product reviewed before (a second tab, a
 * resubmit) is skipped by the unique key rather than overwritten — once in
 * moderation, the text is the manager's to judge, not the customer's to swap.
 * Returns the rows actually created.
 */
export async function createReviews(
  db: Db,
  orderId: string,
  authorName: string,
  entries: NewReview[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const created = await db
    .insert(reviews)
    .values(entries.map((entry) => ({ ...entry, orderId, authorName })))
    .onConflictDoNothing({ target: [reviews.orderId, reviews.productId] })
    .returning({ id: reviews.id });
  return created.length;
}

/* ------------------------------------------------------------- storefront */

export interface PublishedReview {
  authorName: string;
  rating: number;
  body: string | null;
  publishedAt: Date;
}

export interface ProductReviews {
  count: number;
  /** One decimal, e.g. 4.8. Zero when there are none. */
  average: number;
  reviews: PublishedReview[];
}

const SHOWN_REVIEWS = 50;

export async function getProductReviews(db: Db, slug: string): Promise<ProductReviews> {
  const published = and(eq(products.slug, slug), eq(reviews.status, 'published'));

  const [summary, rows] = await Promise.all([
    db
      .select({ count: count(), average: sql<string | null>`round(avg(${reviews.rating}), 1)` })
      .from(reviews)
      .innerJoin(products, eq(products.id, reviews.productId))
      .where(published),
    db
      .select({
        authorName: reviews.authorName,
        rating: reviews.rating,
        body: reviews.body,
        publishedAt: sql<Date>`coalesce(${reviews.publishedAt}, ${reviews.createdAt})`.mapWith(
          (value: string | Date) => new Date(value),
        ),
      })
      .from(reviews)
      .innerJoin(products, eq(products.id, reviews.productId))
      .where(published)
      .orderBy(desc(reviews.publishedAt))
      .limit(SHOWN_REVIEWS),
  ]);

  return {
    count: summary[0]?.count ?? 0,
    average: Number(summary[0]?.average ?? 0),
    reviews: rows,
  };
}

/* ------------------------------------------------------------------ panel */

export interface AdminReviewRow {
  id: string;
  status: ReviewStatus;
  authorName: string;
  rating: number;
  body: string | null;
  createdAt: Date;
  productTitle: string;
  productSlug: string;
  orderNumber: string;
}

export async function listAdminReviews(db: Db, status: ReviewStatus): Promise<AdminReviewRow[]> {
  return db
    .select({
      id: reviews.id,
      status: reviews.status,
      authorName: reviews.authorName,
      rating: reviews.rating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      productTitle: productTranslations.title,
      productSlug: products.slug,
      orderNumber: orders.orderNumber,
    })
    .from(reviews)
    .innerJoin(products, eq(products.id, reviews.productId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, LOCALE)),
    )
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .where(eq(reviews.status, status))
    .orderBy(desc(reviews.createdAt))
    .limit(200);
}

export async function countPendingReviews(db: Db): Promise<number> {
  const [row] = await db.select({ count: count() }).from(reviews).where(eq(reviews.status, 'pending'));
  return row?.count ?? 0;
}

/** Publish or reject. Publishing stamps the date the storefront sorts by; rejecting keeps it, so a re-publish lands where it was. */
export async function setReviewStatus(
  db: Db,
  id: string,
  status: 'published' | 'rejected',
): Promise<boolean> {
  const updated = await db
    .update(reviews)
    .set(
      status === 'published'
        ? { status, publishedAt: sql`coalesce(${reviews.publishedAt}, now())` }
        : { status },
    )
    .where(eq(reviews.id, id))
    .returning({ id: reviews.id });
  return updated.length > 0;
}

/* ------------------------------------------------------------------- cron */

/**
 * Claims the one review e-mail an order gets: stamps `review_requested_at`
 * only if it is still empty, and returns what the e-mail needs only to the
 * caller that stamped it. A manager's revert and the carrier's re-advance to
 * `delivered` therefore never send a second one.
 */
export async function claimReviewRequest(
  db: Db,
  orderId: string,
): Promise<{ customerName: string; customerEmail: string | null; reviewToken: string } | null> {
  const [row] = await db
    .update(orders)
    .set({ reviewRequestedAt: sql`now()` })
    .where(and(eq(orders.id, orderId), isNull(orders.reviewRequestedAt)))
    .returning({
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      reviewToken: orders.reviewToken,
    });
  return row ?? null;
}
