ALTER TABLE "products" DROP CONSTRAINT "products_companion_not_self";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_companion_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "companion_product_id";