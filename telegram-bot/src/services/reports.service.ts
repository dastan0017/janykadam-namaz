import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { enrollments, pointsLedger, reportDrafts, reports } from '../db/schema';
import { canSubmitLate, reportPoints } from '../domain/scoring';
import {
  closedWindowsOfDay, dayEvaluationAt, isoWeekKey, localDateShift, nextWindowAfter,
  openWindowsAt, toLocalDate, windowsForDay, type EnabledTopics, type WindowInstance,
} from '../domain/windows';
import type { ActiveContext } from './participants.service';
import { PrayerService } from './prayer.service';
import { TopicsService } from './topics.service';

export type Draft = typeof reportDrafts.$inferSelect;

export interface Candidates {
  /** Открытые сейчас и ещё не сданные. */
  open: WindowInstance[];
  /** Закрывшиеся сегодня, но доступные как поздняя сдача. */
  late: WindowInstance[];
}

const DRAFT_TTL_MIN = 15;

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly topics: TopicsService,
    private readonly prayer: PrayerService,
  ) {}

  /** Три локальные даты вокруг момента: окна пересекают полночь в обе стороны. */
  private datesAround(at: Date, tz: string): string[] {
    const today = toLocalDate(at, tz);
    return [localDateShift(today, -1), today, localDateShift(today, 1)];
  }

  private async reportedKeys(enrollmentId: string, dayKeys: string[]): Promise<Set<string>> {
    if (dayKeys.length === 0) return new Set();
    const rows = await this.db
      .select({ topicId: reports.topicId, dayKey: reports.dayKey })
      .from(reports)
      .where(and(eq(reports.enrollmentId, enrollmentId), inArray(reports.dayKey, dayKeys)));
    return new Set(rows.map((r) => `${r.topicId}|${r.dayKey}`));
  }

  /** Недельные темы, уже сданные на этой ISO-неделе. */
  private async weeklyDone(enrollmentId: string, weekKey: string, from: string, to: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ topicId: reports.topicId, dayKey: reports.dayKey })
      .from(reports)
      .where(and(eq(reports.enrollmentId, enrollmentId), gte(reports.dayKey, from), lte(reports.dayKey, to)));
    return new Set(rows.filter((r) => isoWeekKey(r.dayKey) === weekKey).map((r) => r.topicId));
  }

  /**
   * Что участница может сдать прямо сейчас.
   *
   * Для проверки окна берётся время отправки сообщения, а не момент обработки:
   * между ними может пройти время, и окно успеет закрыться.
   */
  async candidates(ctx: ActiveContext, at: Date): Promise<Candidates> {
    const { participant, enrollment, marathon } = ctx;
    if (!participant.lat || !participant.lng || !participant.tz) return { open: [], late: [] };

    const tz = participant.tz;
    const enabled = await this.topics.enabledFor(marathon.id);
    const dates = this.datesAround(at, tz);
    const lookup = await this.prayer.lookupFor(participant.lat, participant.lng, [
      ...dates,
      localDateShift(dates[2], 1),
    ]);

    const reported = await this.reportedKeys(enrollment.id, dates);
    const today = toLocalDate(at, tz);

    const weeklyIds = new Set(enabled.custom.filter((c) => c.freq === 'weekly').map((c) => c.id));
    const weekDone = weeklyIds.size
      ? await this.weeklyDone(enrollment.id, isoWeekKey(today), localDateShift(today, -8), localDateShift(today, 8))
      : new Set<string>();

    const notYet = (w: WindowInstance) =>
      !reported.has(`${w.topicId}|${w.dayKey}`) && !(weeklyIds.has(w.topicId) && weekDone.has(w.topicId));

    const open = openWindowsAt(enabled, at, tz, lookup).filter(notYet);

    // Поздняя сдача доступна, пока день ещё можно оценить — то есть пока не
    // закрылось последнее обязательное окно этого дня (для Куптана — до фаджра).
    let late: WindowInstance[] = [];
    if (canSubmitLate(marathon.latePasses, enrollment.latePassesUsed)) {
      const evaluateAt = dayEvaluationAt(enabled, today, tz, lookup);
      const stillOpenDay = !evaluateAt || at.getTime() < evaluateAt.getTime();
      if (stillOpenDay) {
        late = closedWindowsOfDay(enabled, today, at, tz, lookup).filter(notYet);
      }
    }

    return { open, late };
  }

  /** Ближайшее окно после момента — для подсказки «следующая тема в HH:MM». */
  async nextWindow(ctx: ActiveContext, at: Date): Promise<WindowInstance | null> {
    const { participant, marathon } = ctx;
    if (!participant.lat || !participant.lng || !participant.tz) return null;
    const enabled = await this.topics.enabledFor(marathon.id);
    const dates = this.datesAround(at, participant.tz);
    const lookup = await this.prayer.lookupFor(participant.lat, participant.lng, [...dates, localDateShift(dates[2], 1)]);
    return nextWindowAfter(enabled, at, participant.tz, lookup);
  }

  /** Окна сегодняшнего дня со статусом — для /ball. */
  async todayStatus(ctx: ActiveContext, at: Date): Promise<{ window: WindowInstance; done: boolean }[]> {
    const { participant, enrollment, marathon } = ctx;
    if (!participant.lat || !participant.lng || !participant.tz) return [];

    const tz = participant.tz;
    const today = toLocalDate(at, tz);
    const enabled = await this.topics.enabledFor(marathon.id);
    const lookup = await this.prayer.lookupFor(participant.lat, participant.lng, [
      localDateShift(today, -1), today, localDateShift(today, 1),
    ]);
    const reported = await this.reportedKeys(enrollment.id, [today]);

    return windowsForDay(enabled, today, tz, lookup).map((w) => ({
      window: w,
      done: reported.has(`${w.topicId}|${w.dayKey}`),
    }));
  }

  /* ───────── черновики ───────── */

  async findDraft(id: string): Promise<Draft | undefined> {
    const [row] = await this.db.select().from(reportDrafts).where(eq(reportDrafts.id, id)).limit(1);
    if (!row) return undefined;
    if (row.expiresAt.getTime() < Date.now()) {
      await this.dropDraft(row.id);
      return undefined;
    }
    return row;
  }

  async dropDraft(id: string): Promise<void> {
    await this.db.delete(reportDrafts).where(eq(reportDrafts.id, id));
  }

  /** Новый видеокружок отменяет незавершённый черновик. */
  async dropDraftsOf(participantId: string): Promise<void> {
    await this.db.delete(reportDrafts).where(eq(reportDrafts.participantId, participantId));
  }

  async createDraft(input: {
    participantId: string;
    enrollmentId: string;
    videoFileId: string;
    videoFileUniqueId: string;
    videoDurationSec?: number;
    sentAt: Date;
  }): Promise<Draft> {
    await this.dropDraftsOf(input.participantId);
    const [row] = await this.db
      .insert(reportDrafts)
      .values({
        participantId: input.participantId,
        enrollmentId: input.enrollmentId,
        videoFileId: input.videoFileId,
        videoFileUniqueId: input.videoFileUniqueId,
        videoDurationSec: input.videoDurationSec ?? null,
        sentAt: input.sentAt,
        expiresAt: new Date(Date.now() + DRAFT_TTL_MIN * 60_000),
      })
      .returning();
    return row;
  }

  async assignTopic(draftId: string, w: WindowInstance, late: boolean): Promise<Draft> {
    const [row] = await this.db
      .update(reportDrafts)
      .set({
        topicKind: w.topicKind,
        topicId: w.topicId,
        dayKey: w.dayKey,
        windowOpensAt: w.opensAt,
        windowClosesAt: w.closesAt,
        late,
        questionIndex: 0,
        answers: {},
      })
      .where(eq(reportDrafts.id, draftId))
      .returning();
    return row;
  }

  async setAnswers(draftId: string, answers: Record<string, unknown>, questionIndex: number): Promise<Draft> {
    const [row] = await this.db
      .update(reportDrafts)
      .set({ answers, questionIndex })
      .where(eq(reportDrafts.id, draftId))
      .returning();
    return row;
  }

  /** Этот видеокружок уже засчитан — защита от повторной отправки одного файла. */
  async videoAlreadyUsed(fileUniqueId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(eq(reports.videoFileUniqueId, fileUniqueId))
      .limit(1);
    return !!row;
  }

  async hasReport(enrollmentId: string, topicId: string, dayKey: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.enrollmentId, enrollmentId), eq(reports.topicId, topicId), eq(reports.dayKey, dayKey)))
      .limit(1);
    return !!row;
  }

  /**
   * Сохраняет отчёт, начисляет баллы и пишет в журнал — одной транзакцией.
   * Возвращает начисленное и новый итог.
   */
  async save(input: {
    draft: Draft;
    topicPoints: number;
    optionPoints: number[];
    topicName: string;
    consumesLatePass: boolean;
  }): Promise<{ awarded: number; total: number }> {
    const { draft } = input;
    if (!draft.topicId || !draft.dayKey || !draft.windowOpensAt || !draft.windowClosesAt || !draft.topicKind) {
      throw new Error('Черновик без выбранной темы');
    }

    const awarded = reportPoints(input.topicPoints, input.optionPoints);

    return this.db.transaction(async (tx) => {
      const [report] = await tx
        .insert(reports)
        .values({
          enrollmentId: draft.enrollmentId,
          topicKind: draft.topicKind!,
          topicId: draft.topicId!,
          dayKey: draft.dayKey!,
          windowOpensAt: draft.windowOpensAt!,
          windowClosesAt: draft.windowClosesAt!,
          submittedAt: draft.sentAt,
          late: draft.late,
          videoFileId: draft.videoFileId,
          videoFileUniqueId: draft.videoFileUniqueId,
          videoDurationSec: draft.videoDurationSec,
          pointsAwarded: awarded,
          answers: draft.answers,
        })
        .returning();

      await tx.insert(pointsLedger).values({
        enrollmentId: draft.enrollmentId,
        delta: awarded,
        reason: `${input.topicName} — отчёт принят`,
        reportId: report.id,
      });

      const [updated] = await tx
        .update(enrollments)
        .set({
          points: sql`${enrollments.points} + ${awarded}`,
          latePassesUsed: input.consumesLatePass
            ? sql`${enrollments.latePassesUsed} + 1`
            : enrollments.latePassesUsed,
        })
        .where(eq(enrollments.id, draft.enrollmentId))
        .returning();

      await tx.delete(reportDrafts).where(eq(reportDrafts.id, draft.id));

      return { awarded, total: updated.points };
    });
  }

  /** Чистка просроченных черновиков — вызывается по расписанию. */
  async purgeExpiredDrafts(): Promise<number> {
    const rows = await this.db
      .delete(reportDrafts)
      .where(lte(reportDrafts.expiresAt, new Date()))
      .returning({ id: reportDrafts.id });
    return rows.length;
  }

  enabledTopicsOf(marathonId: string): Promise<EnabledTopics> {
    return this.topics.enabledFor(marathonId);
  }
}
