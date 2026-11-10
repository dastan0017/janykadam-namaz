import { eq } from 'drizzle-orm';
import type { StorageAdapter } from 'grammy';
import type { Db } from '../db/drizzle.module';
import { botSessions } from '../db/schema';

/** Шаг диалога. Отсутствие шага означает «ждём видеокружок или команду». */
export type Step =
  | 'choose_lang'
  | 'choose_location'
  | 'location_search'
  | 'answering'
  | 'pause_length'
  | 'goal';

export interface SessionData {
  step?: Step;
  /** Марафон, в который записываем сразу после регистрации. */
  pendingMarathonId?: string;
  /** Последняя выдача поиска городов: id → данные для кнопки. */
  searchHits?: Record<string, { lat: number; lng: number; label: string; cc: string; tz: string }>;
  /** Незавершённый отчёт. */
  draftId?: string;
  /** Когда в последний раз отвечали «только видеокружок» — не чаще раза в 10 минут. */
  videoOnlyAt?: number;
}

export function initialSession(): SessionData {
  return {};
}

/**
 * Сессии в Postgres: флоу (выбор места, ответы на вопросы) переживают
 * перезапуск процесса, иначе участница зависает посреди диалога.
 */
export class PgSessionStorage implements StorageAdapter<SessionData> {
  constructor(private readonly db: Db) {}

  async read(key: string): Promise<SessionData | undefined> {
    const [row] = await this.db.select().from(botSessions).where(eq(botSessions.key, key)).limit(1);
    return row ? (row.value as SessionData) : undefined;
  }

  async write(key: string, value: SessionData): Promise<void> {
    await this.db
      .insert(botSessions)
      .values({ key, value: value as Record<string, unknown>, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: botSessions.key,
        set: { value: value as Record<string, unknown>, updatedAt: new Date() },
      });
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(botSessions).where(eq(botSessions.key, key));
  }
}
