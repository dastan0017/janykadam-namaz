import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { enrollments, marathons, participants } from '../db/schema';
import { reminderInstant, shiftOutOfQuiet } from '../domain/reminders';
import { dayEvaluationAt, localDateShift, localTimeToInstant, parseHHMM, toLocalDate } from '../domain/windows';
import { PrayerService } from '../services/prayer.service';
import { SettingsService } from '../services/settings.service';
import { TopicsService } from '../services/topics.service';
import { BossService, QUEUE } from './boss.service';

export interface TopicReminderJob {
  enrollmentId: string;
  topicKind: 'namaz' | 'custom';
  topicId: string;
  dayKey: string;
  opensAt: string;
  closesAt: string;
}

export interface DigestJob {
  enrollmentId: string;
  dayKey: string;
}

/**
 * Планировщик дня.
 *
 * Раз в 15 минут проходит по активным записям, у которых местное время уже
 * перевалило за 00:05, и ставит задания на этот день: напоминание по каждой
 * теме, утреннее и вечернее сообщения, оценку дня.
 *
 * Ключ singletonKey детерминированный, поэтому повторное планирование
 * (после /zona, смены тем, перезапуска) ничего не дублирует.
 */
@Injectable()
export class PlannerService {
  private readonly log = new Logger(PlannerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly boss: BossService,
    private readonly topics: TopicsService,
    private readonly prayer: PrayerService,
    private readonly settings: SettingsService,
  ) {}

  /** Планирует день для всех, кому пора. Возвращает число запланированных записей. */
  async planAll(now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .select({ enrollment: enrollments, participant: participants, marathon: marathons })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .where(and(eq(enrollments.status, 'active'), inArray(marathons.status, ['running', 'recruiting'])));

    let planned = 0;
    for (const row of rows) {
      if (!row.participant.tz || row.participant.lat === null || row.participant.lng === null) continue;
      if (row.participant.blocked) continue;

      const local = DateTime.fromJSDate(now, { zone: row.participant.tz });
      // Ждём, пока местные сутки начнутся: план строится на уже наступивший день.
      if (local.hour * 60 + local.minute < 5) continue;

      const dayKey = local.toFormat('yyyy-MM-dd');
      if (dayKey < row.marathon.startDate || dayKey > row.marathon.endDate) continue;

      try {
        await this.planDay(row.enrollment.id, row.participant, row.marathon, dayKey);
        planned++;
      } catch (err) {
        this.log.error(`План для ${row.enrollment.id} на ${dayKey}: ${String(err)}`);
      }
    }
    return planned;
  }

  /** Ставит все задания одного дня одной участницы. */
  async planDay(
    enrollmentId: string,
    participant: { tz: string | null; lat: number | null; lng: number | null; tahajjudReminders: boolean },
    marathon: { id: string; remindMorning: string | null; remindEvening: string | null },
    dayKey: string,
  ): Promise<void> {
    const tz = participant.tz!;
    const enabled = await this.topics.enabledFor(marathon.id);
    const lookup = await this.prayer.lookupFor(participant.lat!, participant.lng!, [
      localDateShift(dayKey, -1), dayKey, localDateShift(dayKey, 1), localDateShift(dayKey, 2),
    ]);

    const boss = this.boss.instance;
    const { windowsForDay } = await import('../domain/windows');
    const windows = windowsForDay(enabled, dayKey, tz, lookup);
    const { quietFrom, quietTo } = await this.settings.getSettings();

    for (const w of windows) {
      // Тахажуд планируем только согласившимся: окно внутри тихих часов.
      if (w.optIn && !participant.tahajjudReminders) continue;

      let at = reminderInstant(w.opensAt, w.closesAt, w.remindOffsetMin);
      // Тема открылась ночью, в тихие часы: напоминаем, как только они
      // кончатся, — если окно к тому времени ещё открыто. Иначе о ней не
      // напомнили бы вовсе. Тахажуд — по согласию, он тихие часы обходит.
      if (!w.optIn) at = shiftOutOfQuiet(at, tz, quietFrom, quietTo);
      if (at.getTime() >= w.closesAt.getTime()) continue;
      if (at.getTime() <= Date.now()) continue;

      const payload: TopicReminderJob = {
        enrollmentId,
        topicKind: w.topicKind,
        topicId: w.topicId,
        dayKey: w.dayKey,
        opensAt: w.opensAt.toISOString(),
        closesAt: w.closesAt.toISOString(),
      };

      await boss.send(QUEUE.reminderTopic, payload, {
        startAfter: at,
        singletonKey: `rem:${enrollmentId}:${w.topicId}:${w.dayKey}`,
      });
    }

    // Утреннее и вечернее — по местному времени марафона.
    if (marathon.remindMorning) {
      const at = localTimeToInstant(dayKey, parseHHMM(marathon.remindMorning.slice(0, 5)), tz);
      if (at.getTime() > Date.now()) {
        await boss.send(QUEUE.reminderMorning, { enrollmentId, dayKey } satisfies DigestJob, {
          startAfter: at,
          singletonKey: `morning:${enrollmentId}:${dayKey}`,
        });
      }
    }
    if (marathon.remindEvening) {
      const at = localTimeToInstant(dayKey, parseHHMM(marathon.remindEvening.slice(0, 5)), tz);
      if (at.getTime() > Date.now()) {
        await boss.send(QUEUE.reminderEvening, { enrollmentId, dayKey } satisfies DigestJob, {
          startAfter: at,
          singletonKey: `evening:${enrollmentId}:${dayKey}`,
        });
      }
    }

    // Оценка дня — когда закроется последнее обязательное окно (для Куптана это фаджр).
    const evaluateAt = dayEvaluationAt(enabled, dayKey, tz, lookup);
    if (evaluateAt) {
      await boss.send(QUEUE.evaluateDay, { enrollmentId, dayKey } satisfies DigestJob, {
        startAfter: evaluateAt,
        singletonKey: `eval:${enrollmentId}:${dayKey}`,
      });
    }

    // Недельный итог — воскресенье 20:00 по её времени.
    const d = DateTime.fromISO(dayKey, { zone: 'utc' });
    if (d.weekday === 7) {
      const at = localTimeToInstant(dayKey, 20 * 60, tz);
      if (at.getTime() > Date.now()) {
        await boss.send(QUEUE.weeklySummary, { enrollmentId, dayKey } satisfies DigestJob, {
          startAfter: at,
          singletonKey: `weekly:${enrollmentId}:${dayKey}`,
        });
      }
    }
  }

  /** Перепланировать сегодняшний день: после /zona, паузы, смены тем. */
  async replanToday(enrollmentId: string): Promise<void> {
    const [row] = await this.db
      .select({ enrollment: enrollments, participant: participants, marathon: marathons })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .where(eq(enrollments.id, enrollmentId))
      .limit(1);

    if (!row?.participant.tz || row.participant.lat === null || row.participant.lng === null) return;
    const dayKey = toLocalDate(new Date(), row.participant.tz);
    await this.planDay(enrollmentId, row.participant, row.marathon, dayKey);
  }
}
