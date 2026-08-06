CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX "np_warehouses_settlement_idx";--> statement-breakpoint
ALTER TABLE "np_settlements" ADD COLUMN "name_ru" text;--> statement-breakpoint
ALTER TABLE "np_settlements" ADD COLUMN "name_translit" text;--> statement-breakpoint
ALTER TABLE "np_settlements" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "np_warehouses" ADD COLUMN "number_sort" integer;--> statement-breakpoint
ALTER TABLE "np_warehouses" ADD COLUMN "description_ru" text;--> statement-breakpoint
ALTER TABLE "np_warehouses" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "np_warehouses" ADD COLUMN "is_postomat" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Backfill, hand-written on top of the generated DDL.
--
-- The new columns are what /checkout searches against, so they cannot sit
-- empty until the next nightly Nova Poshta sync — that would take the
-- settlement picker down for up to a day. The `translate`/`regexp_replace`
-- pair below reproduces `fold()` from packages/lib/src/novaposhta/normalize.ts
-- (verified equal against real rows for Київ, Львів, Дніпро, Харків,
-- Івано-Франківськ and Кам'янець-Подільський before this was committed).
--
-- Only the Ukrainian spelling can be backfilled here — `name_ru` and
-- `name_translit` do not exist locally yet and arrive with the first sync run
-- after this migration, which then rewrites `search_text` properly.
UPDATE "np_settlements" AS s SET "search_text" = CASE
  WHEN f.folded LIKE '% %' THEN f.folded || ' ' || replace(f.folded, ' ', '')
  ELSE f.folded
END
FROM (
  SELECT "ref", trim(regexp_replace(
    translate(lower("name"), 'іїыйєэёґьъ''’ʼ`´', 'ииииееег'),
    '[^[:alnum:]]+', ' ', 'g'
  )) AS folded
  FROM "np_settlements"
) AS f
WHERE s."ref" = f."ref";--> statement-breakpoint

UPDATE "np_warehouses" AS w SET "search_text" = CASE
  WHEN f.folded LIKE '% %' THEN f.folded || ' ' || replace(f.folded, ' ', '')
  ELSE f.folded
END
FROM (
  SELECT "ref", trim(regexp_replace(
    translate(lower("description"), 'іїыйєэёґьъ''’ʼ`´', 'ииииееег'),
    '[^[:alnum:]]+', ' ', 'g'
  )) AS folded
  FROM "np_warehouses"
) AS f
WHERE w."ref" = f."ref";--> statement-breakpoint

-- `type_ref` holds the resolved Ukrainian type description, so this is the
-- same match the queries used to run per request.
UPDATE "np_warehouses" SET "is_postomat" = ("type_ref" ILIKE '%поштомат%');--> statement-breakpoint

-- Bounded to 9 digits so a malformed value cannot overflow int4; anything else
-- sorts last rather than aborting the migration.
UPDATE "np_warehouses" SET "number_sort" =
  CASE WHEN "number" ~ '^[0-9]{1,9}$' THEN "number"::integer ELSE NULL END;--> statement-breakpoint

CREATE INDEX "np_settlements_search_idx" ON "np_settlements" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "np_warehouses_lookup_idx" ON "np_warehouses" USING btree ("settlement_ref","is_postomat","is_active","number_sort");
