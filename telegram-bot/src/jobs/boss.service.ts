import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { env } from '../config/env';

/** Имена очередей. Держим в одном месте, чтобы не разъезжались. */
export const QUEUE = {
  plan: 'plan-day',
  reminderTopic: 'reminder-topic',
  reminderMorning: 'reminder-morning',
  reminderEvening: 'reminder-evening',
  weeklySummary: 'weekly-summary',
  evaluateDay: 'evaluate-day',
  lifecycle: 'lifecycle',
  precompute: 'precompute-prayer',
  broadcastSend: 'broadcast-send',
  purgeDrafts: 'purge-drafts',
} as const;

/**
 * pg-boss поверх той же базы: отдельный Redis не нужен.
 * Все задания идемпотентны по singletonKey, поэтому повтор после перезапуска
 * ничего не дублирует.
 */
@Injectable()
export class BossService implements OnApplicationShutdown {
  private readonly log = new Logger(BossService.name);
  private boss?: PgBoss;

  async start(): Promise<PgBoss> {
    if (this.boss) return this.boss;

    this.boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: 'pgboss' });
    this.boss.on('error', (err: unknown) => this.log.error(`pg-boss: ${String(err)}`));

    await this.boss.start();
    // Политика повторов задаётся на очереди: временный сбой сети не теряет напоминание.
    for (const name of Object.values(QUEUE)) {
      await this.boss.createQueue(name, { retryLimit: 3, retryBackoff: true });
    }
    this.log.log('pg-boss запущен');
    return this.boss;
  }

  get instance(): PgBoss {
    if (!this.boss) throw new Error('pg-boss ещё не запущен');
    return this.boss;
  }

  async healthy(): Promise<boolean> {
    try {
      await this.instance.getQueue(QUEUE.plan);
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true });
  }
}
