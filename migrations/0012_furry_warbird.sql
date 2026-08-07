ALTER TABLE "np_warehouses" ADD COLUMN "city_ref" text;--> statement-breakpoint
ALTER TABLE "np_settlements" DROP COLUMN "delivery_city_ref";