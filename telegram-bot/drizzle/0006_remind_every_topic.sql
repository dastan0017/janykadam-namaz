ALTER TABLE "bot_settings" ALTER COLUMN "cap_per_day" SET DEFAULT 0;--> statement-breakpoint
-- Заказчица хочет напоминание при открытии каждой темы, а прежний лимит 6 в
-- день при одиннадцати темах молча срезал половину. 6 — значение сида, его
-- никто не выбирал; если лимит ставили руками, оставляем как есть.
UPDATE "bot_settings" SET "cap_per_day" = 0 WHERE "cap_per_day" = 6;
