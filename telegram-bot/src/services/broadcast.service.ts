import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { broadcastDeliveries, broadcasts, enrollments, participants, reports } from '../db/schema';
import { shiftOutOfQuiet } from '../domain/reminders';
import { render } from '../domain/text';
import { localTimeToInstant, parseHHMM, toLocalDate } from '../domain/windows';
import { SettingsService } from './settings.service';

/** Сегменты получателей. Считаются по текущим данным участниц в момент создания. */
export type Segment =
  | { kind: 'all_active' }
  | { kind: 'not_today' }
  | { kind: 'silent_3d' }
  | { kind: 'paused' }
  | { kind: 'new_today' }
  | { kind: 'tz'; tz: string }
  | { kind: 'selected'; participantIds: string[] };

export type Schedule = { kind: 'now' } | { kind: 'tomorrow'; at: string };

export interface RecipientRow {
  participantId: string;
  chatId: string;
  lang: 'kg' | 'ru';
  firstName: string;
  points: number;
  tz: string | null;
}

@Injectable()
export class BroadcastService {
  private readonly log = new Logger(BroadcastService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /** Кто попадёт в рассылку. Вышедшие и заблокировавшие бота исключены всегда. */
  async resolveSegment(marathonId: string, segment: Segment): Promise<RecipientRow[]> {
    const base = await this.db
      .select({
        participantId: participants.id,
        chatId: participants.chatId,
        lang: participants.lang,
        firstName: participants.firstName,
        tz: participants.tz,
        points: enrollments.points,
        status: enrollments.status,
        enrollmentId: enrollments.id,
        joinedAt: enrollments.joinedAt,
      })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .where(
        and(
          eq(enrollments.marathonId, marathonId),
          inArray(enrollments.status, ['active', 'paused']),
          eq(participants.blocked, false),
        ),
      );

    const activeOnly = base.filter((r) => r.status === 'active');

    switch (segment.kind) {
      case 'all_active':
        return activeOnly;

      case 'paused':
        return base.filter((r) => r.status === 'paused');

      case 'tz':
        return activeOnly.filter((r) => r.tz === segment.tz);

      case 'selected':
        return base.filter((r) => segment.participantIds.includes(r.participantId));

      case 'new_today': {
        return activeOnly.filter((r) => {
          const tz = r.tz ?? 'Asia/Bishkek';
          return toLocalDate(r.joinedAt, tz) === toLocalDate(new Date(), tz);
        });
      }

      case 'not_today': {
        const withReports = await this.reportedTodayIds(activeOnly);
        return activeOnly.filter((r) => !withReports.has(r.enrollmentId));
      }

      case 'silent_3d': {
        const recent = await this.reportedSinceIds(activeOnly, 3);
        return activeOnly.filter((r) => !recent.has(r.enrollmentId));
      }
    }
  }

  private async reportedTodayIds(rows: { enrollmentId: string; tz: string | null }[]): Promise<Set<string>> {
    if (rows.length === 0) return new Set();
    const all = await this.db
      .select({ enrollmentId: reports.enrollmentId, dayKey: reports.dayKey })
      .from(reports)
      .where(inArray(reports.enrollmentId, rows.map((r) => r.enrollmentId)));

    const byId = new Map(rows.map((r) => [r.enrollmentId, r.tz ?? 'Asia/Bishkek']));
    const out = new Set<string>();
    for (const r of all) {
      const tz = byId.get(r.enrollmentId);
      if (tz && r.dayKey === toLocalDate(new Date(), tz)) out.add(r.enrollmentId);
    }
    return out;
  }

  private async reportedSinceIds(rows: { enrollmentId: string; tz: string | null }[], days: number): Promise<Set<string>> {
    if (rows.length === 0) return new Set();
    const all = await this.db
      .select({ enrollmentId: reports.enrollmentId, dayKey: reports.dayKey })
      .from(reports)
      .where(inArray(reports.enrollmentId, rows.map((r) => r.enrollmentId)));

    const byId = new Map(rows.map((r) => [r.enrollmentId, r.tz ?? 'Asia/Bishkek']));
    const out = new Set<string>();
    for (const r of all) {
      const tz = byId.get(r.enrollmentId);
      if (!tz) continue;
      const cutoff = DateTime.now().setZone(tz).minus({ days }).toFormat('yyyy-MM-dd');
      if (r.dayKey > cutoff) out.add(r.enrollmentId);
    }
    return out;
  }

  /** Подставляет плейсхолдеры под конкретную участницу. */
  fill(text: string, r: RecipientRow, marathonName: string): string {
    return render(text, {
      имя: r.firstName.split(' ')[0],
      баллы: r.points,
      марафон: marathonName,
    });
  }

  /**
   * Создаёт рассылку и фиксирует список получателей.
   *
   * Снимок делается сразу: если участница присоединится через час, она не должна
   * внезапно получить вчерашнее сообщение.
   */
  async create(input: {
    marathonId: string;
    text: string;
    segment: Segment;
    schedule: Schedule;
    createdBy?: string;
  }): Promise<{ id: string; count: number }> {
    const recipients = await this.resolveSegment(input.marathonId, input.segment);
    const settings = await this.settings.getSettings();

    const [row] = await this.db
      .insert(broadcasts)
      .values({
        marathonId: input.marathonId,
        text: input.text,
        segment: input.segment as unknown as Record<string, unknown>,
        schedule: input.schedule as unknown as Record<string, unknown>,
        status: 'scheduled',
        totals: { count: recipients.length, sent: 0, blocked: 0, failed: 0 },
        createdBy: input.createdBy ?? null,
      })
      .returning();

    if (recipients.length > 0) {
      await this.db.insert(broadcastDeliveries).values(
        recipients.map((r) => ({
          broadcastId: row.id,
          participantId: r.participantId,
          // «Завтра в HH:MM» — по местному времени каждой участницы.
          sendAfter: this.sendAfterFor(input.schedule, r.tz ?? 'Asia/Bishkek', settings.quietFrom, settings.quietTo),
        })),
      );
    }

    return { id: row.id, count: recipients.length };
  }

  private sendAfterFor(schedule: Schedule, tz: string, quietFrom: string, quietTo: string): Date {
    if (schedule.kind === 'now') return new Date();

    const tomorrow = DateTime.now().setZone(tz).plus({ days: 1 }).toFormat('yyyy-MM-dd');
    const at = localTimeToInstant(tomorrow, parseHHMM(schedule.at), tz);
    // Попадание в тихие часы сдвигается на их конец, а не отменяется.
    return shiftOutOfQuiet(at, tz, quietFrom, quietTo);
  }

  async progress(id: string): Promise<{ status: string; totals: Record<string, number> } | null> {
    const [row] = await this.db.select().from(broadcasts).where(eq(broadcasts.id, id)).limit(1);
    if (!row) return null;

    const counts = await this.db
      .select({ status: broadcastDeliveries.status, n: sql<number>`count(*)::int` })
      .from(broadcastDeliveries)
      .where(eq(broadcastDeliveries.broadcastId, id))
      .groupBy(broadcastDeliveries.status);

    const totals: Record<string, number> = { count: 0, pending: 0, sent: 0, blocked: 0, failed: 0 };
    for (const c of counts) {
      totals[c.status] = c.n;
      totals.count += c.n;
    }
    return { status: row.status, totals };
  }

  async list(marathonId: string) {
    return this.db.select().from(broadcasts).where(eq(broadcasts.marathonId, marathonId));
  }
}
