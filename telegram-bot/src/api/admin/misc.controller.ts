import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException,
  Param, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { BotService } from '../../bot/bot.service';
import { env } from '../../config/env';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import {
  adminUsers, auditLog, botSettings, botTexts, enrollments, locationPresets, marathons, participants, reports,
} from '../../db/schema';
import { prayerTimes } from '../../domain/prayer';
import { toLocalDate } from '../../domain/windows';
import { BroadcastService, type Schedule, type Segment } from '../../services/broadcast.service';
import { PrayerService } from '../../services/prayer.service';
import { SettingsService } from '../../services/settings.service';
import { AuthService, SESSION_COOKIE } from '../auth/auth.service';
import { AdminOnly, Public, type AuthedRequest } from '../auth/guards';

const segmentSchema: z.ZodType<Segment> = z.union([
  z.object({ kind: z.literal('all_active') }),
  z.object({ kind: z.literal('not_today') }),
  z.object({ kind: z.literal('silent_3d') }),
  z.object({ kind: z.literal('paused') }),
  z.object({ kind: z.literal('new_today') }),
  z.object({ kind: z.literal('tz'), tz: z.string() }),
  z.object({ kind: z.literal('selected'), participantIds: z.array(z.string().uuid()) }),
]);

const scheduleSchema: z.ZodType<Schedule> = z.union([
  z.object({ kind: z.literal('now') }),
  z.object({ kind: z.literal('tomorrow'), at: z.string().regex(/^\d{2}:\d{2}$/) }),
]);

@Controller('api')
export class MiscController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly auth: AuthService,
    private readonly broadcasts: BroadcastService,
    private readonly settings: SettingsService,
    private readonly prayer: PrayerService,
    private readonly bot: BotService,
  ) {}

  /* ───────── вход ───────── */

  @Public()
  @Post('auth/telegram')
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: FastifyReply) {
    const { token, user } = await this.auth.loginWithTelegram(body as never);
    void res.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env().NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 86_400,
    });
    return { id: user.id, name: user.name, role: user.role };
  }

  @Post('auth/logout')
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: FastifyReply) {
    await this.auth.logout((req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]);
    void res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: AuthedRequest) {
    const a = req.admin!;
    return { id: a.id, name: a.name, tgUsername: a.tgUsername, role: a.role, status: a.status };
  }

  /* ───────── рассылки ───────── */

  @Post('marathons/:id/broadcasts/preview')
  async preview(@Param('id') marathonId: string, @Body() body: unknown) {
    const { segment, text } = z.object({ segment: segmentSchema, text: z.string().optional() }).parse(body);
    const recipients = await this.broadcasts.resolveSegment(marathonId, segment);
    const [marathon] = await this.db.select().from(marathons).where(eq(marathons.id, marathonId)).limit(1);

    return {
      count: recipients.length,
      // Превью рендерится для первого получателя — видно, как подставились плейсхолдеры.
      sample: recipients[0] && text ? this.broadcasts.fill(text, recipients[0], marathon?.name ?? '') : null,
    };
  }

  @Post('marathons/:id/broadcasts')
  async createBroadcast(@Param('id') marathonId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { text, segment, schedule } = z
      .object({ text: z.string().min(1).max(4096), segment: segmentSchema, schedule: scheduleSchema })
      .parse(body);

    const result = await this.broadcasts.create({ marathonId, text, segment, schedule, createdBy: req.admin?.id });
    await this.auth.audit(req.admin ?? null, 'create', 'broadcast', result.id, { count: result.count });
    return result;
  }

  @Get('marathons/:id/broadcasts')
  listBroadcasts(@Param('id') marathonId: string) {
    return this.broadcasts.list(marathonId);
  }

  @Get('broadcasts/:id')
  async broadcastProgress(@Param('id') id: string) {
    const p = await this.broadcasts.progress(id);
    if (!p) throw new NotFoundException('Рассылка не найдена');
    return p;
  }

  /* ───────── аналитика ───────── */

  @Get('marathons/:id/analytics')
  async analytics(@Param('id') marathonId: string) {
    const rows = await this.db
      .select({ enrollmentId: enrollments.id, tz: participants.tz, status: enrollments.status, joinedAt: enrollments.joinedAt })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .where(eq(enrollments.marathonId, marathonId));

    const active = rows.filter((r) => r.status === 'active');
    const ids = rows.map((r) => r.enrollmentId);

    const byTopic = ids.length
      ? await this.db
          .select({ topicId: reports.topicId, n: sql<number>`count(*)::int` })
          .from(reports)
          .where(and(inArray(reports.enrollmentId, ids), eq(reports.dayKey, toLocalDate(new Date(), 'Asia/Bishkek'))))
          .groupBy(reports.topicId)
      : [];

    const byTz = new Map<string, { total: number; done: number }>();
    const reportedToday = new Set(
      ids.length
        ? (
            await this.db
              .select({ enrollmentId: reports.enrollmentId, dayKey: reports.dayKey })
              .from(reports)
              .where(inArray(reports.enrollmentId, ids))
          )
            .filter((r) => {
              const tz = rows.find((x) => x.enrollmentId === r.enrollmentId)?.tz ?? 'Asia/Bishkek';
              return r.dayKey === toLocalDate(new Date(), tz);
            })
            .map((r) => r.enrollmentId)
        : [],
    );

    for (const r of active) {
      const key = r.tz ?? 'Asia/Bishkek';
      const cur = byTz.get(key) ?? { total: 0, done: 0 };
      cur.total++;
      if (reportedToday.has(r.enrollmentId)) cur.done++;
      byTz.set(key, cur);
    }

    const everReported = ids.length
      ? new Set(
          (await this.db.select({ enrollmentId: reports.enrollmentId }).from(reports).where(inArray(reports.enrollmentId, ids))).map(
            (r) => r.enrollmentId,
          ),
        )
      : new Set<string>();

    return {
      byTopic,
      byTz: [...byTz].map(([tz, v]) => ({ tz, ...v })),
      funnel: {
        registered: rows.length,
        firstReport: everReported.size,
        activeToday: reportedToday.size,
      },
      dropoff: active.filter((r) => !reportedToday.has(r.enrollmentId)).length,
    };
  }

  /* ───────── намазы ───────── */

  @Get('prayer/presets')
  async prayerPresets() {
    const presets = await this.db.select().from(locationPresets);
    return Promise.all(
      presets.map(async (p) => ({
        label: p.labelRu,
        tz: p.tz,
        times: await this.prayer.times(p.lat, p.lng, toLocalDate(new Date(), p.tz)),
      })),
    );
  }

  @Get('prayer/times')
  async prayerAt(@Query('lat') lat: string, @Query('lng') lng: string, @Query('date') date?: string) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) throw new BadRequestException('Нужны lat и lng');
    return prayerTimes(la, ln, date ?? toLocalDate(new Date(), 'UTC'));
  }

  /* ───────── настройки бота и тексты ───────── */

  @Get('bot/settings')
  async botSettingsGet() {
    // Имя и username бота живут в Telegram, а не в базе: панель показывает
    // deep link `t.me/<username>?start=<код>` и даёт править имя.
    const settings = await this.settings.getSettings();
    let username = '';
    let name = '';
    try {
      username = this.bot.bot.botInfo.username;
      name = this.bot.bot.botInfo.first_name;
    } catch {
      // Бот ещё не инициализирован (или Telegram недоступен) — панель покажет прочерк.
    }
    return { ...settings, username, name };
  }

  @Patch('bot/settings')
  async botSettingsPatch(@Body() body: unknown, @Req() req: AuthedRequest) {
    const data = z
      .object({
        quietFrom: z.string().optional(),
        quietTo: z.string().optional(),
        capPerDay: z.number().int().min(0).optional(),
        menu: z.array(z.string()).optional(),
        commands: z.array(z.object({ command: z.string(), description: z.string() })).optional(),
        description: z.string().optional(),
        shortDescription: z.string().optional(),
      })
      .parse(body);

    await this.db.update(botSettings).set(data).where(eq(botSettings.id, 1));
    this.settings.invalidate();

    // Команды и описания применяются в Telegram сразу.
    try {
      if (data.commands) await this.bot.bot.api.setMyCommands(data.commands);
      if (data.description !== undefined) await this.bot.bot.api.setMyDescription(data.description);
      if (data.shortDescription !== undefined) await this.bot.bot.api.setMyShortDescription(data.shortDescription);
    } catch {
      // Telegram может отказать (лимиты) — настройки уже сохранены.
    }

    await this.auth.audit(req.admin ?? null, 'update', 'bot_settings', null, data as Record<string, unknown>);
    return this.settings.getSettings();
  }

  /** Имя бота — отдельная ручка: Telegram ограничивает частоту его смены. */
  @Post('bot/name')
  async botName(@Body() body: unknown, @Req() req: AuthedRequest) {
    const { name } = z.object({ name: z.string().min(1).max(64) }).parse(body);
    await this.bot.bot.api.setMyName(name);
    await this.auth.audit(req.admin ?? null, 'set_name', 'bot', null, { name });
    return { ok: true, name };
  }

  @Get('bot/texts')
  botTextsList() {
    return this.db.select().from(botTexts);
  }

  @Patch('bot/texts/:key')
  async botTextPatch(@Param('key') key: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const data = z.object({ ru: z.string().optional(), kg: z.string().optional() }).parse(body);
    const [row] = await this.db.update(botTexts).set(data).where(eq(botTexts.key, key)).returning();
    if (!row) throw new NotFoundException('Текст не найден');
    this.settings.invalidate();
    await this.auth.audit(req.admin ?? null, 'update', 'bot_text', key, data as Record<string, unknown>);
    return row;
  }

  /* ───────── пользователи панели (только админ) ───────── */

  @AdminOnly()
  @Get('users')
  users() {
    return this.db.select().from(adminUsers).orderBy(desc(adminUsers.createdAt));
  }

  @AdminOnly()
  @Post('users')
  async addUser(@Body() body: unknown, @Req() req: AuthedRequest) {
    const data = z
      .object({ name: z.string().min(1), tgUsername: z.string().regex(/^@?[A-Za-z0-9_]{5,32}$/), role: z.enum(['admin', 'curator']) })
      .parse(body);
    const tgUsername = data.tgUsername.replace(/^@/, '');

    const [row] = await this.db
      .insert(adminUsers)
      .values({ name: data.name, tgUsername, role: data.role, status: 'invited' })
      .returning();
    await this.auth.audit(req.admin ?? null, 'create', 'admin_user', row.id, { tgUsername, role: data.role });
    return row;
  }

  @AdminOnly()
  @Patch('users/:id')
  async setRole(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { role } = z.object({ role: z.enum(['admin', 'curator']) }).parse(body);
    if (id === req.admin?.id) throw new ForbiddenException('Свою роль поменять нельзя');

    const [target] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    if (!target) throw new NotFoundException('Пользователь не найден');
    if (target.role === 'admin' && role !== 'admin' && (await this.auth.activeAdminCount()) <= 1) {
      throw new ForbiddenException('В панели должен остаться хотя бы один админ');
    }

    const [row] = await this.db.update(adminUsers).set({ role }).where(eq(adminUsers.id, id)).returning();
    await this.auth.audit(req.admin ?? null, 'set_role', 'admin_user', id, { role });
    return row;
  }

  @AdminOnly()
  @Delete('users/:id')
  async disableUser(@Param('id') id: string, @Req() req: AuthedRequest) {
    if (id === req.admin?.id) throw new ForbiddenException('Себя отключить нельзя');

    const [target] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    if (!target) throw new NotFoundException('Пользователь не найден');
    if (target.role === 'admin' && (await this.auth.activeAdminCount()) <= 1) {
      throw new ForbiddenException('В панели должен остаться хотя бы один админ');
    }

    await this.db.update(adminUsers).set({ status: 'disabled' }).where(eq(adminUsers.id, id));
    await this.auth.audit(req.admin ?? null, 'disable', 'admin_user', id, {});
    return { ok: true };
  }

  /* ───────── журнал ───────── */

  @Get('audit')
  async audit(@Query('limit') limit = '50', @Query('offset') offset = '0') {
    return this.db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(Math.min(Number(limit) || 50, 200))
      .offset(Number(offset) || 0);
  }
}
