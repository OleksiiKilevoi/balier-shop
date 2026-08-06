CREATE TYPE "public"."admin_role" AS ENUM('manager', 'admin');--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "role" "admin_role" DEFAULT 'manager' NOT NULL;