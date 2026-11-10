CREATE TYPE "public"."excused_scope" AS ENUM('day', 'namaz');--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "excused_days" ADD COLUMN "scope" "excused_scope" DEFAULT 'day' NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "last_name" text DEFAULT '' NOT NULL;