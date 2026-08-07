CREATE TABLE "np_scan_sheets" (
	"ref" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
