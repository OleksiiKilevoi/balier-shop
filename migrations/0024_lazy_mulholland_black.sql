CREATE TABLE "product_companions" (
	"product_id" uuid NOT NULL,
	"companion_product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_companions_product_id_companion_product_id_pk" PRIMARY KEY("product_id","companion_product_id"),
	CONSTRAINT "product_companions_not_self" CHECK ("product_companions"."product_id" <> "product_companions"."companion_product_id")
);
--> statement-breakpoint
ALTER TABLE "product_companions" ADD CONSTRAINT "product_companions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_companions" ADD CONSTRAINT "product_companions_companion_product_id_products_id_fk" FOREIGN KEY ("companion_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;