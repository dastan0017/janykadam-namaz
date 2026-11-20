CREATE TABLE "bot_channels" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"username" text,
	"invite_link" text,
	"status" text NOT NULL,
	"can_post" boolean DEFAULT false NOT NULL,
	"can_invite" boolean DEFAULT false NOT NULL,
	"can_restrict" boolean DEFAULT false NOT NULL,
	"protected_content" boolean DEFAULT false NOT NULL,
	"added_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "channel_invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "channel_joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marathons" ADD COLUMN "channel_link" text;--> statement-breakpoint
ALTER TABLE "marathons" ADD COLUMN "channel_chat_id" text;--> statement-breakpoint
ALTER TABLE "marathons" ADD COLUMN "channel_title" text;--> statement-breakpoint
ALTER TABLE "marathons" ADD COLUMN "channel_invite_link" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "channel_state" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "channel_chat_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "channel_message_id" integer;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "channel_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "marathons_channel_chat_key" ON "marathons" USING btree ("channel_chat_id");--> statement-breakpoint
CREATE INDEX "reports_channel_pending_idx" ON "reports" USING btree ("submitted_at") WHERE "reports"."channel_state" = 'pending';