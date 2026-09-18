CREATE TYPE "public"."parcel_size" AS ENUM('small', 'large');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "parcel_size" "parcel_size" DEFAULT 'small' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" DROP COLUMN "weight_grams";