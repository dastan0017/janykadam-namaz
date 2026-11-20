import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { enrollments, excusedDays, marathons, participants, pointsLedger, reports } from '../db/schema';
import { isQuietAt } from '../domain/reminders';
import { decideReminder } from '../domain/reminders';
import { advanceStreak, isDayComplete } from '../domain/scoring';
import { joinTopics } from '../domain/text';
import { localDateShift, marathonDayNumber, toLocalDate, windowsForDay } from '../domain/windows';
import { NotifyService } from '../services/notify.service';
import { ParticipantsService } from '../services/participants.service';
import { PrayerService } from '../services/prayer.service';
import { ReportsService } from '../services/reports.service';
import { SettingsService } from '../services/settings.service';
import { TopicsService } from '../services/topics.service';
import { BossService, QUEUE } from './boss.service';
import { PlannerService, type DigestJob, type TopicReminderJob } from './planner.service';

const MARATHON_DAYS = 30;

/** Воркеры pg-boss: напоминания, сводки, оценка дня, жизненный цикл, кэш намазов. */
@Injectable()
export class WorkersService implements OnModuleInit {
  private readonly log = new Logger(WorkersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly boss: BossService,
    private readonly planner: PlannerService,
    private readonly notify: NotifyService,
    private readonly settings: SettingsService,
    private readonly topics: TopicsService,
    private readonly prayer: PrayerService,
    private readonly reports: ReportsService,
    private readonly participants: ParticipantsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const boss = await this.boss.start();

    await boss.work<TopicReminderJob>(QUEUE.reminderTopic, (jobs) => this.onTopicReminder(jobs));
    await boss.work<DigestJob>(QUEUE.reminderMorning, (jobs) => this.onMorning(jobs));
    await boss.work<DigestJob>(QUEUE.reminderEvening, (jobs) => this.onEvening(jobs));
    await boss.work<DigestJob>(QUEUE.weeklySummary, (jobs) => this.onWeekly(jobs));
    await boss.work<DigestJob>(QUEUE.evaluateDay, (jobs) => this.onEvaluateDay(jobs));
    await boss.work(QUEUE.plan, () => this.onPlan());
    await boss.work(QUEUE.lifecycle, () => this.onLifecycle());
    await boss.work(QUEUE.precompute, () => this.onPrecompute());
    await boss.work(QUEUE.purgeDrafts, () => this.onPurgeDrafts());

    // Расписания. Планировщик — каждые 15 минут, остальное раз в сутки.
    await boss.schedule(QUEUE.plan, '*/15 * * * *');
    await boss.schedule(QUEUE.lifecycle, '7 * * * *');
    await boss.schedule(QUEUE.precompute, '20 1 * * *');
    await boss.schedule(QUEUE.purgeDrafts, '*/30 * * * *');

    this.log.log('Воркеры и расписания зарегистрированы');
  }

  /* ───────── планирование ───────── */

  private async onPlan(): Promise<void> {
    const n = await this.planner.planAll();
    if (n) this.log.debug(`Запланировано записей: ${n}`);
  }

  /* ───────── напоминание по теме ───────── */

  private async onTopicReminder(jobs: { data: TopicReminderJob }[]): Promise<void> {
    for (const { data } of jobs) {
      try {
        await this.sendTopicReminder(data);
      } catch (err) {
        this.log.error(`Напоминание ${data.enrollmentId}/${data.topicId}: ${String(err)}`);
      }
    }
  }

  /**
   * Одно напоминание по теме. Публичный метод: все проверки делаются здесь, в
   * момент срабатывания, поэтому он же — точка входа для тестов.
   */
  async sendTopicReminder(data: TopicReminderJob): Promise<void> {
    const r = await this.notify.recipientOf(data.enrollmentId);
    if (!r) return;

    const [row] = await this.db
      .select({ participant: participants, enrollment: enrollments, marathon: marathons })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .where(eq(enrollments.id, data.enrollmentId))
      .limit(1);
    if (!row?.participant.tz) return;

    const settings = await this.settings.getSettings();
    const enabled = await this.topics.enabledFor(row.marathon.id);
    const stillEnabled =
      enabled.namaz.includes(data.topicId as never) || enabled.custom.some((c) => c.id === data.topicId);

    const reported = await this.reports.hasReport(data.enrollmentId, data.topicId, data.dayKey);
    const now = new Date();
    const closesAt = new Date(data.closesAt);

    const namaz = enabled.namaz.includes(data.topicId as never);
    const optIn = data.topicId === 't1';
    // Узур: о намазах сегодня не напоминаем — свои темы марафона остаются.
    const uzurNamaz = namaz && (await this.participants.namazExcusedDays(data.enrollmentId, [data.dayKey])).has(data.dayKey);

    // Всё перепроверяем сейчас, а не на этапе планирования.
    const decision = decideReminder({
      enrollmentActive: row.enrollment.status === 'active',
      paused: row.enrollment.status === 'paused',
      blocked: row.participant.blocked,
      topicEnabled: stillEnabled,
      alreadyReported: reported,
      windowClosed: now.getTime() >= closesAt.getTime(),
      quiet: isQuietAt(now, row.participant.tz, settings.quietFrom, settings.quietTo),
      sentToday: await this.notify.sentToday(data.enrollmentId, data.dayKey),
      capPerDay: settings.capPerDay,
      optIn,
      optedIn: row.participant.tahajjudReminders,
      uzurNamaz,
    });

    if (!decision.send) {
      this.log.debug(`Напоминание пропущено (${decision.reason}): ${data.topicId}`);
      return;
    }

    // Уникальный индекс гарантирует, что после перезапуска не отправим второй раз.
    const fresh = await this.notify.markSent(data.enrollmentId, 'topic', data.topicId, data.dayKey);
    if (!fresh) return;

    const meta = namaz
      ? enabled.namaz.includes(data.topicId as never)
        ? (await import('../domain/namaz')).NAMAZ_BY_ID.get(data.topicId as never)
        : undefined
      : enabled.custom.find((c) => c.id === data.topicId);
    if (!meta) return;

    const name = r.lang === 'kg' ? meta.nameKg || meta.nameRu : meta.nameRu || meta.nameKg;
    const text = await this.settings.t('reminder_topic', r.lang, {
      эмодзи: meta.emoji,
      тема: name,
      конец_окна: DateTime.fromJSDate(closesAt, { zone: row.participant.tz }).toFormat('HH:mm'),
    });

    await this.notify.send(r, text, { withSwitchButton: true });
  }

  /* ───────── утро, вечер, неделя ───────── */

  private async onMorning(jobs: { data: DigestJob }[]): Promise<void> {
    for (const { data } of jobs) {
      const r = await this.notify.recipientOf(data.enrollmentId);
      if (!r || r.status !== 'active' || r.blocked) continue;

      const [row] = await this.db
        .select({ participant: participants, marathon: marathons })
        .from(enrollments)
        .innerJoin(participants, eq(participants.id, enrollments.participantId))
        .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
        .where(eq(enrollments.id, data.enrollmentId))
        .limit(1);
      if (!row) continue;

      const settings = await this.settings.getSettings();
      if (isQuietAt(new Date(), row.participant.tz!, settings.quietFrom, settings.quietTo)) continue;
      if (!(await this.notify.markSent(data.enrollmentId, 'morning', null, data.dayKey))) continue;

      const dayN = marathonDayNumber(row.marathon.startDate, data.dayKey);
      await this.notify.send(
        r,
        await this.settings.t('reminder_morning', r.lang, {
          имя: row.participant.firstName,
          день: dayN,
          дней: MARATHON_DAYS,
        }),
      );
    }
  }

  private async onEvening(jobs: { data: DigestJob }[]): Promise<void> {
    for (const { data } of jobs) {
      const r = await this.notify.recipientOf(data.enrollmentId);
      if (!r || r.status !== 'active' || r.blocked) continue;

      const ctx = await this.contextOf(data.enrollmentId);
      if (!ctx) continue;

      const now = new Date();
      const settings = await this.settings.getSettings();
      if (isQuietAt(now, ctx.participant.tz!, settings.quietFrom, settings.quietTo)) continue;

      // Перечисляем то, что ещё можно сдать или вот-вот откроется сегодня.
      const status = await this.reports.todayStatus(ctx, now);
      const pending = status.filter((s) => !s.done && !s.uzur && s.window.closesAt.getTime() > now.getTime());
      if (pending.length === 0) continue;

      if (!(await this.notify.markSent(data.enrollmentId, 'evening', null, data.dayKey))) continue;

      await this.notify.send(
        r,
        await this.settings.t('reminder_evening', r.lang, {
          несданные: joinTopics(
            pending.map((s) => ({
              emoji: s.window.emoji,
              name: r.lang === 'kg' ? s.window.nameKg : s.window.nameRu || s.window.nameKg,
              until: DateTime.fromJSDate(s.window.closesAt, { zone: ctx.participant.tz! }).toFormat('HH:mm'),
            })),
          ),
        }),
      );
    }
  }

  private async onWeekly(jobs: { data: DigestJob }[]): Promise<void> {
    for (const { data } of jobs) {
      const r = await this.notify.recipientOf(data.enrollmentId);
      if (!r || r.status !== 'active' || r.blocked) continue;
      if (!(await this.notify.markSent(data.enrollmentId, 'weekly', null, data.dayKey))) continue;

      const from = localDateShift(data.dayKey, -6);
      const rows = await this.db
        .select({ id: reports.id })
        .from(reports)
        .where(and(eq(reports.enrollmentId, data.enrollmentId), sql`${reports.dayKey} between ${from} and ${data.dayKey}`));

      const [e] = await this.db.select().from(enrollments).where(eq(enrollments.id, data.enrollmentId)).limit(1);
      const week = DateTime.fromISO(data.dayKey, { zone: 'utc' }).weekNumber;

      await this.notify.send(
        r,
        await this.settings.t('weekly_summary', r.lang, {
          неделя: week,
          сдано: rows.length,
          всего: rows.length,
          баллы: e?.points ?? 0,
        }),
      );
    }
  }

  /* ───────── оценка дня и серия ───────── */

  private async onEvaluateDay(jobs: { data: DigestJob }[]): Promise<void> {
    for (const { data } of jobs) {
      try {
        await this.evaluateDay(data.enrollmentId, data.dayKey);
      } catch (err) {
        this.log.error(`Оценка дня ${data.enrollmentId}/${data.dayKey}: ${String(err)}`);
      }
    }
  }

  async evaluateDay(enrollmentId: string, dayKey: string): Promise<void> {
    const ctx = await this.contextOf(enrollmentId);
    if (!ctx) return;
    if (!(await this.notify.markSent(enrollmentId, 'eval', null, dayKey))) return;

    const tz = ctx.participant.tz!;
    const enabled = await this.topics.enabledFor(ctx.marathon.id);
    const lookup = await this.prayer.lookupFor(ctx.participant.lat!, ctx.participant.lng!, [
      localDateShift(dayKey, -1), dayKey, localDateShift(dayKey, 1),
    ]);

    const mandatory = windowsForDay(enabled, dayKey, tz, lookup).filter((w) => w.mandatory);
    const rows = await this.db
      .select({ topicId: reports.topicId })
      .from(reports)
      .where(and(eq(reports.enrollmentId, enrollmentId), eq(reports.dayKey, dayKey)));

    const [excused] = await this.db
      .select({ dayKey: excusedDays.dayKey, scope: excusedDays.scope })
      .from(excusedDays)
      .where(and(eq(excusedDays.enrollmentId, enrollmentId), eq(excusedDays.dayKey, dayKey)))
      .limit(1);

    const complete = isDayComplete({
      mandatory,
      reportedTopicIds: new Set(rows.map((r) => r.topicId)),
      excused: excused?.scope === 'day',
      namazExcused: excused?.scope === 'namaz',
      paused: ctx.enrollment.status === 'paused',
      joinedAt: ctx.enrollment.joinedAt,
    });

    const next = advanceStreak(
      { streak: ctx.enrollment.streak, bestStreak: ctx.enrollment.bestStreak },
      complete,
      { streakEvery: ctx.marathon.streakEvery, streakBonus: ctx.marathon.streakBonus },
    );

    await this.db
      .update(enrollments)
      .set({ streak: next.streak, bestStreak: next.bestStreak })
      .where(eq(enrollments.id, enrollmentId));

    if (next.bonusAwarded) {
      await this.db.transaction(async (tx) => {
        await tx.insert(pointsLedger).values({
          enrollmentId,
          delta: next.bonusPoints,
          reason: `Бонус за ${next.streak} дней подряд`,
        });
        await tx
          .update(enrollments)
          .set({ points: sql`${enrollments.points} + ${next.bonusPoints}` })
          .where(eq(enrollments.id, enrollmentId));
      });

      const r = await this.notify.recipientOf(enrollmentId);
      if (r && !r.blocked) {
        await this.notify.send(
          r,
          await this.settings.t('streak_bonus', r.lang, { дней: next.streak, бонус: next.bonusPoints }),
        );
      }
    }
  }

  /* ───────── жизненный цикл ───────── */

  private async onLifecycle(): Promise<void> {
    const todayBishkek = toLocalDate(new Date(), 'Asia/Bishkek');

    // Набор переходит в «идёт» в день старта по Бишкеку.
    await this.db
      .update(marathons)
      .set({ status: 'running' })
      .where(and(eq(marathons.status, 'recruiting'), lte(marathons.startDate, todayBishkek)));

    // Записи завершаются, когда у участницы закончился её местный последний день.
    const live = await this.db
      .select({ enrollment: enrollments, participant: participants, marathon: marathons })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .where(inArray(enrollments.status, ['active', 'paused']));

    for (const row of live) {
      if (!row.participant.tz) continue;
      const localToday = toLocalDate(new Date(), row.participant.tz);
      if (localToday <= row.marathon.endDate) continue;

      await this.db.update(enrollments).set({ status: 'finished' }).where(eq(enrollments.id, row.enrollment.id));

      const r = await this.notify.recipientOf(row.enrollment.id);
      if (r && !r.blocked) {
        await this.notify.send(
          r,
          await this.settings.t('marathon_finished', r.lang, {
            марафон: row.marathon.name,
            баллы: row.enrollment.points,
            серия: row.enrollment.bestStreak,
          }),
        );
      }
    }

    // Марафон завершён, когда завершились все его записи.
    const running = await this.db.select().from(marathons).where(eq(marathons.status, 'running'));
    for (const m of running) {
      const open = await this.db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(and(eq(enrollments.marathonId, m.id), inArray(enrollments.status, ['active', 'paused'])))
        .limit(1);
      if (open.length === 0 && toLocalDate(new Date(), 'Asia/Bishkek') > m.endDate) {
        await this.db.update(marathons).set({ status: 'finished' }).where(eq(marathons.id, m.id));
      }
    }

    // Автоснятие паузы по сроку.
    await this.db
      .update(enrollments)
      .set({ status: 'active', pausedUntil: null })
      .where(and(eq(enrollments.status, 'paused'), lte(enrollments.pausedUntil, todayBishkek)));
  }

  /* ───────── кэш намазов и чистка ───────── */

  private async onPrecompute(): Promise<void> {
    const places = await this.db
      .selectDistinct({ lat: participants.lat, lng: participants.lng })
      .from(participants)
      .where(eq(participants.blocked, false));

    const today = toLocalDate(new Date(), 'UTC');
    const dates = [today, localDateShift(today, 1), localDateShift(today, 2)];
    const valid = places.filter((p): p is { lat: number; lng: number } => p.lat !== null && p.lng !== null);

    const n = await this.prayer.precompute(valid, dates);
    this.log.log(`Кэш намазов прогрет: ${n} записей`);
  }

  private async onPurgeDrafts(): Promise<void> {
    const n = await this.reports.purgeExpiredDrafts();
    if (n) this.log.debug(`Просроченных черновиков удалено: ${n}`);
  }

  /* ───────── общее ───────── */

  private async contextOf(enrollmentId: string) {
    const [row] = await this.db
      .select({ participant: participants, enrollment: enrollments, marathon: marathons })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .where(eq(enrollments.id, enrollmentId))
      .limit(1);
    if (!row?.participant.tz) return null;
    void this.participants;
    return row;
  }
}
