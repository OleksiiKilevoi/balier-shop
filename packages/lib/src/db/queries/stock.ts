import { sql, type SQL } from 'drizzle-orm';
import { productVariants, stockReservations } from '../schema';

/**
 * The one definition of "how many of this variant a customer can actually buy":
 *
 *   available = variant.stock - SUM(unexpired reservations)
 *
 * `stock_reservations` is the single source of truth for what is spoken for —
 * there is deliberately no `reserved` counter on the variant, because two
 * sources of truth drift. Every read of availability goes through this fragment
 * so the catalog, the cart and checkout can never disagree.
 *
 * Correlates to `product_variants`, so it is only valid in a query that selects
 * from that table.
 */
export function availableStock(): SQL<number> {
  return sql<number>`${productVariants.stock} - coalesce((
    select sum(${stockReservations.quantity})
    from ${stockReservations}
    where ${stockReservations.variantId} = ${productVariants.id}
      and ${stockReservations.expiresAt} > now()
  ), 0)::int`;
}
