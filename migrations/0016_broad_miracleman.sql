ALTER TABLE "product_variants" ADD COLUMN "in_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "product_variants" SET "in_stock" = "stock" > 0;--> statement-breakpoint
DROP TABLE "stock_reservations" CASCADE;--> statement-breakpoint
UPDATE "settings" SET "key" = 'payment_ttl_minutes' WHERE "key" = 'reservation_ttl_minutes';
