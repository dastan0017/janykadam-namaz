ALTER TABLE "enrollments" ADD COLUMN "rules_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marathons" ADD COLUMN "rules_kg" text;--> statement-breakpoint
ALTER TABLE "marathons" ADD COLUMN "rules_ru" text;