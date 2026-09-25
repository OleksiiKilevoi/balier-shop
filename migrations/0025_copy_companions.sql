-- The single companion a product could name before 0024 moves into the list.
INSERT INTO "product_companions" ("product_id", "companion_product_id")
SELECT "id", "companion_product_id" FROM "products" WHERE "companion_product_id" IS NOT NULL
ON CONFLICT DO NOTHING;
