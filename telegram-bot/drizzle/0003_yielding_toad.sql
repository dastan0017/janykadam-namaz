DROP INDEX "reminders_log_key";--> statement-breakpoint
-- Старый уникальный индекс не ловил дубли со NULL в topic_id, поэтому в уже
-- работающей базе такие строки могли накопиться: убираем их перед ограничением.
DELETE FROM "reminders_log" a USING "reminders_log" b
  WHERE a.ctid > b.ctid
    AND a."kind" = b."kind"
    AND a."enrollment_id" = b."enrollment_id"
    AND a."day_key" = b."day_key"
    AND a."topic_id" IS NOT DISTINCT FROM b."topic_id";--> statement-breakpoint
ALTER TABLE "reminders_log" ADD CONSTRAINT "reminders_log_key" UNIQUE NULLS NOT DISTINCT("kind","enrollment_id","topic_id","day_key");
