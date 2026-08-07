ALTER TABLE "orders" ADD COLUMN "np_ttn_ref" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "np_ttn_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "np_status_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "np_status_text" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "np_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "np_money_transfer_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "np_scan_sheet_ref" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "weight_grams" integer;