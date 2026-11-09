import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { broadcastDeliveries, broadcasts, enrollments, participants } from '../db/schema';
import { BroadcastService } from '../services/broadcast.service';
import { NotifyService } from '../services/notify.service';
import { ParticipantsService } from '../services/participants.service';
import { BossService, QUEUE } from './boss.service';

/** Сколько доставок берём за один заход. */
const BATCH = 100;

/**
 * Отправка рассылок.
 *
 * Скорость ограничена общим лимитером NotifyService (~25 сообщений в секунду),
 * поэтому рассылка на 500 человек занимает видимые ~20 секунд. Остановить
 * начатую рассылку нельзя — это заявлено в панели.
 */
@Injectable()
export class BroadcastWorker implements OnModuleInit {
  private readonly log = new Logger(BroadcastWorker.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly boss: BossService,
    private readonly notify: NotifyService,
    private readonly broadcastSvc: BroadcastService,
    private readonly participants: ParticipantsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const boss = await this.boss.start();
    await boss.work(QUEUE.broadcastSend, () => this.tick());
    // Каждую минуту забираем доставки, у которых наступило время.
    await boss.schedule(QUEUE.broadcastSend, '* * * * *');
  }

  async tick(): Promise<void> {
    const due = await this.db
      .select({
        broadcastId: broadcastDeliveries.broadcastId,
        participantId: broadcastDeliveries.participantId,
      })
      .from(broadcastDeliveries)
      .where(and(eq(broadcastDeliveries.status, 'pending'), lte(broadcastDeliveries.sendAfter, new Date())))
      .orderBy(asc(broadcastDeliveries.sendAfter))
      .limit(BATCH);

    if (due.length === 0) return;

    const byBroadcast = new Map<string, string[]>();
    for (const d of due) {
      const list = byBroadcast.get(d.broadcastId) ?? [];
      list.push(d.participantId);
      byBroadcast.set(d.broadcastId, list);
    }

    for (const [broadcastId, participantIds] of byBroadcast) {
      await this.sendBatch(broadcastId, participantIds);
    }
  }

  private async sendBatch(broadcastId: string, participantIds: string[]): Promise<void> {
    const [b] = await this.db.select().from(broadcasts).where(eq(broadcasts.id, broadcastId)).limit(1);
    if (!b) return;

    if (b.status === 'scheduled') {
      await this.db.update(broadcasts).set({ status: 'sending' }).where(eq(broadcasts.id, broadcastId));
    }

    const marathon = await this.participants.marathonById(b.marathonId);
    const marathonName = marathon?.name ?? '';

    for (const participantId of participantIds) {
      const [row] = await this.db
        .select({
          participantId: participants.id,
          chatId: participants.chatId,
          lang: participants.lang,
          firstName: participants.firstName,
          tz: participants.tz,
          blocked: participants.blocked,
          points: enrollments.points,
          enrollmentId: enrollments.id,
        })
        .from(participants)
        .innerJoin(
          enrollments,
          and(eq(enrollments.participantId, participants.id), eq(enrollments.marathonId, b.marathonId)),
        )
        .where(eq(participants.id, participantId))
        .limit(1);

      if (!row) {
        await this.markDelivery(broadcastId, participantId, 'failed', 'получатель не найден');
        continue;
      }
      if (row.blocked) {
        await this.markDelivery(broadcastId, participantId, 'blocked', null);
        continue;
      }

      const text = this.broadcastSvc.fill(b.text, row, marathonName);

      const ok = await this.notify.send(
        {
          participantId: row.participantId,
          chatId: row.chatId,
          lang: row.lang,
          enrollmentId: row.enrollmentId,
          marathonName,
        },
        text,
        { withSwitchButton: true },
      );

      await this.markDelivery(broadcastId, participantId, ok ? 'sent' : 'blocked', null);
    }

    await this.finishIfDone(broadcastId);
  }

  private async markDelivery(
    broadcastId: string,
    participantId: string,
    status: 'sent' | 'blocked' | 'failed',
    error: string | null,
  ): Promise<void> {
    await this.db
      .update(broadcastDeliveries)
      .set({ status, sentAt: new Date(), error })
      .where(
        and(
          eq(broadcastDeliveries.broadcastId, broadcastId),
          eq(broadcastDeliveries.participantId, participantId),
        ),
      );
  }

  private async finishIfDone(broadcastId: string): Promise<void> {
    const [pending] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(broadcastDeliveries)
      .where(and(eq(broadcastDeliveries.broadcastId, broadcastId), eq(broadcastDeliveries.status, 'pending')));

    if ((pending?.n ?? 0) > 0) return;

    const progress = await this.broadcastSvc.progress(broadcastId);
    await this.db
      .update(broadcasts)
      .set({ status: 'done', totals: progress?.totals ?? {} })
      .where(eq(broadcasts.id, broadcastId));

    this.log.log(`Рассылка ${broadcastId} завершена: ${JSON.stringify(progress?.totals)}`);
  }
}
