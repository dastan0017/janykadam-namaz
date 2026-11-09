import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { enrollments, excusedDays, marathons, participants, pointsLedger, reports } from '../../db/schema';
import { localDateShift, toLocalDate } from '../../domain/windows';
import { NotifyService } from '../../services/notify.service';
import { ReportsService } from '../../services/reports.service';
import { SettingsService } from '../../services/settings.service';
import { AuthService } from '../auth/auth.service';
import type { AuthedRequest } from '../auth/guards';

@Controller('api')
export class ParticipantsController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly auth: AuthService,
    private readonly notify: NotifyService,
    private readonly settings: SettingsService,
    private readonly reports: ReportsService,
  ) {}

  @Get('marathons/:id/participants')
  async list(
    @Param('id') marathonId: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('tz') tz?: string,
    @Query('activity') activity?: string,
    @Query('sort') sort?: string,
  ) {
    const rows = await this.rowsFor(marathonId);
    const today = (r: (typeof rows)[number]) => toLocalDate(new Date(), r.tz ?? 'Asia/Bishkek');

    const reported = await this.reportedMap(rows.map((r) => r.enrollmentId));

    let out = rows.filter((r) => {
      if (q) {
        const hay = `${r.firstName} ${r.username ?? ''}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      if (status && status !== 'all' && r.status !== status) return false;
      if (tz && tz !== 'all' && r.tz !== tz) return false;
      return true;
    });

    if (activity && activity !== 'all') {
      out = out.filter((r) => {
        const days = reported.get(r.enrollmentId) ?? new Set<string>();
        const t = today(r);
        switch (activity) {
          case 'today':
            return days.has(t);
          case 'not_today':
            return r.status === 'active' && !days.has(t);
          case 'silent_3d': {
            const cutoff = localDateShift(t, -3);
            return r.status === 'active' && ![...days].some((d) => d > cutoff);
          }
          case 'new_today':
            return toLocalDate(r.joinedAt, r.tz ?? 'Asia/Bishkek') === t;
          default:
            return true;
        }
      });
    }

    const key = sort ?? 'name';
    out.sort((a, b) => {
      if (key === 'points') return b.points - a.points;
      if (key === 'tz') return (a.tz ?? '').localeCompare(b.tz ?? '');
      if (key === 'last') return (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0);
      return a.firstName.localeCompare(b.firstName, 'ru');
    });

    return out;
  }

  /** CSV в UTF-8 с BOM и точкой с запятой — чтобы Excel открыл без плясок. */
  @Get('marathons/:id/participants.csv')
  async csv(@Param('id') marathonId: string, @Res() res: FastifyReply) {
    const rows = await this.rowsFor(marathonId);
    const header = ['Имя', 'Telegram', 'Часовой пояс', 'Статус', 'Баллы', 'Серия', 'Лучшая серия'];
    const lines = [header, ...rows.map((r) => [r.firstName, r.username ?? '', r.tz ?? '', r.status, r.points, r.streak, r.bestStreak])];

    const csv = '﻿' + lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    void res
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="participants-${marathonId}.csv"`)
      .send(csv);
  }

  @Get('participants/:id')
  async detail(@Param('id') id: string, @Query('marathon') marathonId?: string) {
    const [p] = await this.db.select().from(participants).where(eq(participants.id, id)).limit(1);
    if (!p) throw new NotFoundException('Участница не найдена');

    const enrolls = await this.db
      .select({ enrollment: enrollments, marathon: marathons })
      .from(enrollments)
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .where(
        marathonId
          ? and(eq(enrollments.participantId, id), eq(enrollments.marathonId, marathonId))
          : eq(enrollments.participantId, id),
      );

    const current = enrolls[0];
    const tz = p.tz ?? 'Asia/Bishkek';
    const today = toLocalDate(new Date(), tz);

    const last7 = current
      ? await this.db
          .select({ dayKey: reports.dayKey, topicId: reports.topicId, points: reports.pointsAwarded })
          .from(reports)
          .where(and(eq(reports.enrollmentId, current.enrollment.id), sql`${reports.dayKey} > ${localDateShift(today, -7)}`))
          .orderBy(desc(reports.dayKey))
      : [];

    const ledger = current
      ? await this.db
          .select()
          .from(pointsLedger)
          .where(eq(pointsLedger.enrollmentId, current.enrollment.id))
          .orderBy(desc(pointsLedger.createdAt))
          .limit(50)
      : [];

    // Окна сегодня в её времени — куратору видно, что у неё сейчас открыто.
    let todayWindows: unknown[] = [];
    if (current && p.lat !== null && p.lng !== null && p.tz) {
      const status = await this.reports.todayStatus(
        { participant: p, enrollment: current.enrollment, marathon: current.marathon },
        new Date(),
      );
      todayWindows = status.map((s) => ({
        topicId: s.window.topicId,
        name: s.window.nameKg,
        opensAt: s.window.opensAt,
        closesAt: s.window.closesAt,
        done: s.done,
      }));
    }

    return {
      participant: p,
      localNow: new Date().toLocaleString('ru-RU', { timeZone: tz }),
      enrollments: enrolls,
      todayWindows,
      last7,
      ledger,
    };
  }

  @Patch('participants/:id')
  async patch(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { marathonId, status } = z
      .object({ marathonId: z.string().uuid(), status: z.enum(['active', 'paused', 'left', 'finished']) })
      .parse(body);

    const [row] = await this.db
      .update(enrollments)
      .set({ status, pausedUntil: status === 'paused' ? null : null })
      .where(and(eq(enrollments.participantId, id), eq(enrollments.marathonId, marathonId)))
      .returning();
    if (!row) throw new NotFoundException('Запись не найдена');

    await this.auth.audit(req.admin ?? null, 'set_status', 'enrollment', row.id, { status });
    return row;
  }

  /** Изменение баллов всегда с причиной: её видит участница и она идёт в журнал. */
  @Post('participants/:id/points')
  async adjustPoints(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { marathonId, delta, reason } = z
      .object({ marathonId: z.string().uuid(), delta: z.number().int(), reason: z.string().min(1) })
      .parse(body);

    if (delta === 0) throw new BadRequestException('Изменение не может быть нулевым');

    const [enrollment] = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.participantId, id), eq(enrollments.marathonId, marathonId)))
      .limit(1);
    if (!enrollment) throw new NotFoundException('Запись не найдена');

    const updated = await this.db.transaction(async (tx) => {
      await tx.insert(pointsLedger).values({
        enrollmentId: enrollment.id,
        delta,
        reason,
        actorAdminId: req.admin?.id ?? null,
      });
      const [e] = await tx
        .update(enrollments)
        .set({ points: sql`${enrollments.points} + ${delta}` })
        .where(eq(enrollments.id, enrollment.id))
        .returning();
      return e;
    });

    await this.auth.audit(req.admin ?? null, 'adjust_points', 'enrollment', enrollment.id, { delta, reason });

    const r = await this.notify.recipientOf(enrollment.id);
    if (r && !r.blocked) {
      await this.notify.send(
        r,
        await this.settings.t('points_adjusted', r.lang, {
          изменение: delta > 0 ? `+${delta}` : String(delta),
          причина: reason,
          всего: updated.points,
        }),
      );
    }
    return updated;
  }

  @Post('participants/:id/excused')
  async excuse(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { marathonId, day } = z
      .object({ marathonId: z.string().uuid(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(body);

    const [enrollment] = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.participantId, id), eq(enrollments.marathonId, marathonId)))
      .limit(1);
    if (!enrollment) throw new NotFoundException('Запись не найдена');

    const [marathon] = await this.db.select().from(marathons).where(eq(marathons.id, marathonId)).limit(1);
    const used = await this.db.select({ d: excusedDays.dayKey }).from(excusedDays).where(eq(excusedDays.enrollmentId, enrollment.id));
    if (used.length >= (marathon?.excusedDays ?? 0)) {
      throw new BadRequestException(`Уважительных дней больше нет (лимит ${marathon?.excusedDays})`);
    }

    await this.db
      .insert(excusedDays)
      .values({ enrollmentId: enrollment.id, dayKey: day, markedBy: req.admin?.id ?? null })
      .onConflictDoNothing();

    await this.auth.audit(req.admin ?? null, 'excuse_day', 'enrollment', enrollment.id, { day });
    return { ok: true };
  }

  /** Исключение: статус left и сообщение участнице. */
  @Delete('participants/:id')
  async remove(@Param('id') id: string, @Query('marathon') marathonId: string, @Req() req: AuthedRequest) {
    const [enrollment] = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.participantId, id), eq(enrollments.marathonId, marathonId)))
      .limit(1);
    if (!enrollment) throw new NotFoundException('Запись не найдена');

    await this.db.update(enrollments).set({ status: 'left' }).where(eq(enrollments.id, enrollment.id));
    await this.auth.audit(req.admin ?? null, 'remove', 'enrollment', enrollment.id, {});

    const r = await this.notify.recipientOf(enrollment.id);
    if (r && !r.blocked) await this.notify.send(r, await this.settings.t('not_enrolled', r.lang));
    return { ok: true };
  }

  /* ───────── общее ───────── */

  private async rowsFor(marathonId: string) {
    return this.db
      .select({
        participantId: participants.id,
        firstName: participants.firstName,
        username: participants.username,
        tz: participants.tz,
        lang: participants.lang,
        blocked: participants.blocked,
        lastSeenAt: participants.lastSeenAt,
        enrollmentId: enrollments.id,
        status: enrollments.status,
        points: enrollments.points,
        streak: enrollments.streak,
        bestStreak: enrollments.bestStreak,
        joinedAt: enrollments.joinedAt,
      })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .where(eq(enrollments.marathonId, marathonId))
      .orderBy(asc(participants.firstName));
  }

  private async reportedMap(enrollmentIds: string[]): Promise<Map<string, Set<string>>> {
    if (enrollmentIds.length === 0) return new Map();
    const rows = await this.db
      .select({ enrollmentId: reports.enrollmentId, dayKey: reports.dayKey })
      .from(reports)
      .where(inArray(reports.enrollmentId, enrollmentIds));

    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = map.get(r.enrollmentId) ?? new Set<string>();
      set.add(r.dayKey);
      map.set(r.enrollmentId, set);
    }
    return map;
  }
}
