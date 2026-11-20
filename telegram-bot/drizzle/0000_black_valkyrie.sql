CREATE TYPE "public"."admin_role" AS ENUM('admin', 'curator');--> statement-breakpoint
CREATE TYPE "public"."admin_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'scheduled', 'sending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'blocked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'paused', 'left', 'finished');--> statement-breakpoint
CREATE TYPE "public"."lang" AS ENUM('kg', 'ru');--> statement-breakpoint
CREATE TYPE "public"."location_source" AS ENUM('preset', 'search', 'geo');--> statement-breakpoint
CREATE TYPE "public"."marathon_status" AS ENUM('draft', 'recruiting', 'running', 'finished', 'archive');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('single', 'multi', 'text', 'number', 'scale', 'yesno');--> statement-breakpoint
CREATE TYPE "public"."topic_freq" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."topic_kind" AS ENUM('namaz', 'custom');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tg_username" text NOT NULL,
	"tg_user_id" text,
	"role" "admin_role" DEFAULT 'curator' NOT NULL,
	"status" "admin_status" DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_admin_id" uuid,
	"actor_label" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_sessions" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"quiet_from" time DEFAULT '22:30' NOT NULL,
	"quiet_to" time DEFAULT '04:30' NOT NULL,
	"cap_per_day" integer DEFAULT 6 NOT NULL,
	"menu" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"short_description" text DEFAULT '' NOT NULL,
	"prayer_tune" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"method_version" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_texts" (
	"key" text PRIMARY KEY NOT NULL,
	"ru" text DEFAULT '' NOT NULL,
	"kg" text DEFAULT '' NOT NULL,
	"placeholders" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_deliveries" (
	"broadcast_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"send_after" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "broadcast_deliveries_broadcast_id_participant_id_pk" PRIMARY KEY("broadcast_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marathon_id" uuid NOT NULL,
	"text" text NOT NULL,
	"segment" jsonb NOT NULL,
	"schedule" jsonb NOT NULL,
	"status" "broadcast_status" DEFAULT 'scheduled' NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"marathon_id" uuid NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paused_until" date,
	"points" integer DEFAULT 0 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"late_passes_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "excused_days" (
	"enrollment_id" uuid NOT NULL,
	"day_key" date NOT NULL,
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "excused_days_enrollment_id_day_key_pk" PRIMARY KEY("enrollment_id","day_key")
);
--> statement-breakpoint
CREATE TABLE "geonames" (
	"geonameid" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"asciiname" text DEFAULT '' NOT NULL,
	"alternatenames" text DEFAULT '' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"country_code" text DEFAULT '' NOT NULL,
	"admin1" text DEFAULT '' NOT NULL,
	"population" integer DEFAULT 0 NOT NULL,
	"timezone" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label_ru" text NOT NULL,
	"label_kg" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"tz" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marathon_namaz" (
	"marathon_id" uuid NOT NULL,
	"namaz_id" text NOT NULL,
	CONSTRAINT "marathon_namaz_marathon_id_namaz_id_pk" PRIMARY KEY("marathon_id","namaz_id")
);
--> statement-breakpoint
CREATE TABLE "marathons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "marathon_status" DEFAULT 'draft' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"default_lang" "lang" DEFAULT 'kg' NOT NULL,
	"reg_open" boolean DEFAULT false NOT NULL,
	"points_default" integer DEFAULT 10 NOT NULL,
	"streak_bonus" integer DEFAULT 5 NOT NULL,
	"streak_every" integer DEFAULT 7 NOT NULL,
	"late_passes" integer DEFAULT 2 NOT NULL,
	"excused_days" integer DEFAULT 3 NOT NULL,
	"pause_allowed" boolean DEFAULT true NOT NULL,
	"remind_morning" time,
	"remind_evening" time,
	"skip_submitted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "namaz_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"position" smallint NOT NULL,
	"emoji" text NOT NULL,
	"name_kg" text NOT NULL,
	"name_ru" text NOT NULL,
	"rule_kg" text NOT NULL,
	"rule_ru" text NOT NULL,
	"points" integer NOT NULL,
	"mandatory" boolean NOT NULL,
	"opt_in" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tg_user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"username" text,
	"lang" "lang" DEFAULT 'kg' NOT NULL,
	"lat" real,
	"lng" real,
	"tz" text,
	"place_label" text,
	"country_code" text,
	"location_source" "location_source",
	"blocked" boolean DEFAULT false NOT NULL,
	"tahajjud_reminders" boolean DEFAULT false NOT NULL,
	"active_enrollment_id" uuid,
	"next_marathon_interest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"actor_admin_id" uuid,
	"report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prayer_times" (
	"lat2" real NOT NULL,
	"lng2" real NOT NULL,
	"local_date" date NOT NULL,
	"method_version" text NOT NULL,
	"fajr" timestamp with time zone NOT NULL,
	"sunrise" timestamp with time zone NOT NULL,
	"dhuhr" timestamp with time zone NOT NULL,
	"asr" timestamp with time zone NOT NULL,
	"maghrib" timestamp with time zone NOT NULL,
	"isha" timestamp with time zone NOT NULL,
	CONSTRAINT "prayer_times_lat2_lng2_local_date_method_version_pk" PRIMARY KEY("lat2","lng2","local_date","method_version")
);
--> statement-breakpoint
CREATE TABLE "question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label_kg" text DEFAULT '' NOT NULL,
	"label_ru" text DEFAULT '' NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid,
	"namaz_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"text_kg" text DEFAULT '' NOT NULL,
	"text_ru" text DEFAULT '' NOT NULL,
	"type" "question_type" DEFAULT 'single' NOT NULL,
	"required" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"topic_id" text,
	"day_key" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"topic_kind" "topic_kind",
	"topic_id" text,
	"day_key" date,
	"window_opens_at" timestamp with time zone,
	"window_closes_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"video_file_id" text NOT NULL,
	"video_file_unique_id" text NOT NULL,
	"video_duration_sec" integer,
	"sent_at" timestamp with time zone NOT NULL,
	"question_index" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"topic_kind" "topic_kind" NOT NULL,
	"topic_id" text NOT NULL,
	"day_key" date NOT NULL,
	"window_opens_at" timestamp with time zone NOT NULL,
	"window_closes_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"video_file_id" text NOT NULL,
	"video_file_unique_id" text NOT NULL,
	"video_duration_sec" integer,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"answers" jsonb
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marathon_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"emoji" text DEFAULT '🕊' NOT NULL,
	"name_kg" text DEFAULT '' NOT NULL,
	"name_ru" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"start_local" time DEFAULT '05:00' NOT NULL,
	"end_local" time DEFAULT '22:00' NOT NULL,
	"points" integer DEFAULT 10 NOT NULL,
	"freq" "topic_freq" DEFAULT 'daily' NOT NULL,
	"mandatory" boolean DEFAULT false NOT NULL,
	"remind_offset_min" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_admin_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_marathon_id_marathons_id_fk" FOREIGN KEY ("marathon_id") REFERENCES "public"."marathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_marathon_id_marathons_id_fk" FOREIGN KEY ("marathon_id") REFERENCES "public"."marathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excused_days" ADD CONSTRAINT "excused_days_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excused_days" ADD CONSTRAINT "excused_days_marked_by_admin_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marathon_namaz" ADD CONSTRAINT "marathon_namaz_marathon_id_marathons_id_fk" FOREIGN KEY ("marathon_id") REFERENCES "public"."marathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marathon_namaz" ADD CONSTRAINT "marathon_namaz_namaz_id_namaz_topics_id_fk" FOREIGN KEY ("namaz_id") REFERENCES "public"."namaz_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_actor_admin_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_namaz_id_namaz_topics_id_fk" FOREIGN KEY ("namaz_id") REFERENCES "public"."namaz_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders_log" ADD CONSTRAINT "reminders_log_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_drafts" ADD CONSTRAINT "report_drafts_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_drafts" ADD CONSTRAINT "report_drafts_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_marathon_id_marathons_id_fk" FOREIGN KEY ("marathon_id") REFERENCES "public"."marathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_key" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_tg_username_key" ON "admin_users" USING btree (lower("tg_username"));--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_tg_user_id_key" ON "admin_users" USING btree ("tg_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "broadcast_deliveries_pending_idx" ON "broadcast_deliveries" USING btree ("status","send_after");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_participant_marathon_key" ON "enrollments" USING btree ("participant_id","marathon_id");--> statement-breakpoint
CREATE INDEX "enrollments_marathon_idx" ON "enrollments" USING btree ("marathon_id","status");--> statement-breakpoint
CREATE INDEX "geonames_population_idx" ON "geonames" USING btree ("population");--> statement-breakpoint
CREATE UNIQUE INDEX "marathons_code_key" ON "marathons" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_tg_user_id_key" ON "participants" USING btree ("tg_user_id");--> statement-breakpoint
CREATE INDEX "participants_tz_idx" ON "participants" USING btree ("tz");--> statement-breakpoint
CREATE INDEX "points_ledger_enrollment_idx" ON "points_ledger" USING btree ("enrollment_id","created_at");--> statement-breakpoint
CREATE INDEX "question_options_question_idx" ON "question_options" USING btree ("question_id","position");--> statement-breakpoint
CREATE INDEX "questions_topic_idx" ON "questions" USING btree ("topic_id","position");--> statement-breakpoint
CREATE INDEX "questions_namaz_idx" ON "questions" USING btree ("namaz_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_log_key" ON "reminders_log" USING btree ("kind","enrollment_id","topic_id","day_key");--> statement-breakpoint
CREATE INDEX "reminders_log_day_idx" ON "reminders_log" USING btree ("enrollment_id","day_key");--> statement-breakpoint
CREATE INDEX "report_drafts_participant_idx" ON "report_drafts" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "report_drafts_expires_idx" ON "report_drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_enrollment_topic_day_key" ON "reports" USING btree ("enrollment_id","topic_id","day_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_video_unique_key" ON "reports" USING btree ("video_file_unique_id");--> statement-breakpoint
CREATE INDEX "reports_enrollment_day_idx" ON "reports" USING btree ("enrollment_id","day_key");--> statement-breakpoint
CREATE INDEX "topics_marathon_idx" ON "topics" USING btree ("marathon_id","position");