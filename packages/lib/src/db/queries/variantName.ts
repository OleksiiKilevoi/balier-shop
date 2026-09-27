import { sql } from 'drizzle-orm';
import { productVariants } from '../schema';

/** `variantLabel` in SQL: «Чорний · M», «M», «Чорний», or NULL. */
export const VARIANT_NAME_SQL = sql<string | null>`nullif(concat_ws(' · ', nullif(trim(${productVariants.colorName}), ''), nullif(trim(${productVariants.size}), '')), '')`;
