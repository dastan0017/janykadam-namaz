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
  channelSync: 'channel-sync',
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
  private starting?: Promise<PgBoss>;

  /**
   * Запоминаем само обещание, а не готовый экземпляр.
   *
   * Воркеры инициализируются параллельно, и оба зовут start(). Если отдавать
   * экземпляр сразу, как только он создан, второй получит его до того, как
   * заведены очереди, и упадёт на schedule(): «queue broadcast-send is not
   * present». На обжитой базе очереди уже есть и race не виден — ломается
   * только первый запуск на чистой.
   */
  start(): Promise<PgBoss> {
    this.starting ??= this.open();
    return this.starting;
  }

  private async open(): Promise<PgBoss> {
    const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: 'pgboss' });
    boss.on('error', (err: unknown) => this.log.error(`pg-boss: ${String(err)}`));

    await boss.start();
    // Политика повторов задаётся на очереди: временный сбой сети не теряет напоминание.
    for (const name of Object.values(QUEUE)) {
      await boss.createQueue(name, { retryLimit: 3, retryBackoff: true });
    }

    this.boss = boss;
    this.log.log('pg-boss запущен');
    return boss;
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
    // Дожидаемся незавершённого запуска, иначе остановка пройдёт мимо него и
    // pg-boss останется работать на уже погашенном приложении.
    await this.starting?.catch(() => undefined);
    await this.boss?.stop({ graceful: true });
  }
}
