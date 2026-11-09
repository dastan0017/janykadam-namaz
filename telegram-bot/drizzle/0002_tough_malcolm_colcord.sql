ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_admin_id_admin_users_id_fk";
--> statement-breakpoint
ALTER TABLE "broadcasts" DROP CONSTRAINT "broadcasts_created_by_admin_users_id_fk";
--> statement-breakpoint
ALTER TABLE "excused_days" DROP CONSTRAINT "excused_days_marked_by_admin_users_id_fk";
--> statement-breakpoint
ALTER TABLE "points_ledger" DROP CONSTRAINT "points_ledger_actor_admin_id_admin_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_admin_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excused_days" ADD CONSTRAINT "excused_days_marked_by_admin_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_actor_admin_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;