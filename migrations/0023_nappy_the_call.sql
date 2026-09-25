ALTER TABLE "products" ADD COLUMN "companion_product_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "companion_discount_percent" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_companion_product_id_products_id_fk" FOREIGN KEY ("companion_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_companion_discount_range" CHECK ("products"."companion_discount_percent" between 0 and 50);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_companion_not_self" CHECK ("products"."companion_product_id" <> "products"."id");