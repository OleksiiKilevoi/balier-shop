ALTER TABLE "admin_users" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "telegram_link_code" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "telegram_link_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "otp_hash" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "otp_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "otp_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_telegram_chat_id_unique" UNIQUE("telegram_chat_id");--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_telegram_link_code_unique" UNIQUE("telegram_link_code");