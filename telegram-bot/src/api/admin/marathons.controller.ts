import {
  BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, Req,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import {
  enrollments, marathonNamaz, marathons, namazTopics, participants, questionOptions, questions, reports, topics,
} from '../../db/schema';
import { BotService } from '../../bot/bot.service';
import { normalizeChannelLink, parseChannelLink } from '../../domain/channel';
import { NAMAZ_IDS } from '../../domain/namaz';
import { hasBlockingErrors } from '../../domain/validation';
import { toLocalDate } from '../../domain/windows';
import { PlannerService } from '../../jobs/planner.service';
import { ChannelError, ChannelsService } from '../../services/channels.service';
import { ValidationService } from '../../services/validation.service';
import { AuthService } from '../auth/auth.service';
import type { AuthedRequest } from '../auth/guards';

/** Ссылка на канал отчётов: хранится в одном виде, `https://t.me/+…` или `https://t.me/имя`. */
const channelLink = z
  .string({ error: 'Вставьте ссылку на канал отчётов' })
  .trim()
  .min(1, 'Вставьте ссылку на канал отчётов')
  .refine((v) => parseChannelLink(v) !== null, 'Это не ссылка на канал. Нужна вида https://t.me/+AbCd… или https://t.me/имя_канала')
  .transform((v) => normalizeChannelLink(parseChannelLink(v)!));

const marathonBody = z.object({
  code: z.string().regex(/^[a-z0-9_]{1,32}$/, 'Код: строчные латинские буквы, цифры и _'),
  name: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  defaultLang: z.enum(['kg', 'ru']).optional(),
  regOpen: z.boolean().optional(),
  // Каждый новый марафон — со своим каналом: без ссылки его не создать.
  channelLink,
});

/** Копия марафона: свои название, даты и обязательно свой канал. */
const duplicateBody = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  channelLink,
});

const marathonPatch = marathonBody.partial().extend({
  status: z.enum(['draft', 'recruiting', 'running', 'finished', 'archive']).optional(),
  pointsDefault: z.number().int().min(0).optional(),
  streakBonus: z.number().int().min(0).optional(),
  streakEvery: z.number().int().min(1).optional(),
  latePasses: z.number().int().min(0).optional(),
  excusedDays: z.number().int().min(0).optional(),
  pauseAllowed: z.boolean().optional(),
  remindMorning: z.string().nullable().optional(),
  remindEvening: z.string().nullable().optional(),
  skipSubmitted: z.boolean().optional(),
  // Пустая строка — «свои правила убрали», тогда действуют общие.
  rulesKg: z.string().nullable().optional(),
  rulesRu: z.string().nullable().optional(),
});

@Controller('api')
export class MarathonsController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly validation: ValidationService,
    private readonly auth: AuthService,
    private readonly planner: PlannerService,
    private readonly channels: ChannelsService,
    private readonly bot: BotService,
  ) {}

  @Get('marathons')
  async list() {
    const rows = await this.db.select().from(marathons).orderBy(asc(marathons.startDate));
    const channels = await this.channels.summaries();
    // Экран «Все марафоны» — сводка по всем сразу, поэтому счётчики идут вместе
    // со списком: иначе панели пришлось бы грузить данные каждого марафона.
    return Promise.all(
      rows.map(async (m) => ({
        ...m,
        namazIds: await this.namazIds(m.id),
        topicsCount: await this.topicsCount(m.id),
        stats: await this.stats(m.id),
        channel: channels.get(m.id),
      })),
    );
  }

  @Post('marathons')
  async create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const data = marathonBody.parse(body);
    const [row] = await this.db.insert(marathons).values({ ...data, status: 'draft' }).returning();
    await this.auth.audit(req.admin ?? null, 'create', 'marathon', row.id, { code: row.code });
    // Бота могли добавить в канал ещё до создания марафона.
    await this.tryAutoLink(row.id);
    return { ...row, channel: await this.channels.summary(row.id) };
  }

  @Get('marathons/:id')
  async get(@Param('id') id: string) {
    const m = await this.find(id);
    return { ...m, namazIds: await this.namazIds(id), stats: await this.stats(id), channel: await this.channels.summary(id) };
  }

  @Patch('marathons/:id')
  async patch(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const data = marathonPatch.parse(body);
    const current = await this.find(id);
    // Ссылка — только чтобы найти канал. Привязанный канал меняют через «Отвязать».
    if (data.channelLink !== undefined && current.channelChatId && data.channelLink !== current.channelLink) {
      throw new BadRequestException('Канал уже подключён. Чтобы сменить его, сначала отвяжите текущий на странице «Канал отчётов»');
    }
    const [row] = await this.db.update(marathons).set(data).where(eq(marathons.id, id)).returning();
    await this.auth.audit(req.admin ?? null, 'update', 'marathon', id, data as Record<string, unknown>);
    if (data.channelLink !== undefined) await this.tryAutoLink(id);
    return { ...row, channel: await this.channels.summary(id) };
  }

  /* ───────── канал отчётов ───────── */

  /**
   * Состояние канала — живое: права бота и «запрет копирования» меняются в
   * Telegram, и панель опрашивает эту ручку, пока админ настраивает канал.
   */
  @Get('marathons/:id/channel')
  async channelStatus(@Param('id') id: string) {
    await this.find(id);
    const api = this.bot.bot.api;
    try {
      const botId = this.bot.bot.botInfo.id;
      await this.channels.refresh(api, botId, id);
      await this.tryAutoLink(id);
    } catch {
      // Telegram недоступен — отдаём то, что знаем из базы.
    }

    const summary = await this.channels.summary(id);
    const free = summary.chatId ? [] : await this.channels.freeChannels();
    return {
      ...summary,
      counts: await this.channels.counts(id),
      // Бот уже в канале, но ссылка не совпала — админ выберет его сам.
      candidates: free.map((c) => ({ chatId: c.chatId, title: c.title, username: c.username })),
      checkedAt: new Date().toISOString(),
    };
  }

  @Post('marathons/:id/channel/connect')
  async channelConnect(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { chatId } = z.object({ chatId: z.string().min(1) }).parse(body);
    await this.find(id);
    try {
      await this.channels.connect(this.bot.bot.api, id, chatId);
    } catch (err) {
      if (err instanceof ChannelError) throw new BadRequestException(err.message);
      throw err;
    }
    await this.auth.audit(req.admin ?? null, 'channel_connect', 'marathon', id, { chatId });
    return this.channelStatus(id);
  }

  @Post('marathons/:id/channel/disconnect')
  async channelDisconnect(@Param('id') id: string, @Req() req: AuthedRequest) {
    const m = await this.find(id);
    try {
      await this.channels.disconnect(this.bot.bot.api, id);
    } catch (err) {
      if (err instanceof ChannelError) throw new BadRequestException(err.message);
      throw err;
    }
    await this.auth.audit(req.admin ?? null, 'channel_disconnect', 'marathon', id, { chatId: m.channelChatId, title: m.channelTitle });
    return this.channelStatus(id);
  }

  private async tryAutoLink(id: string): Promise<void> {
    try {
      await this.channels.autoLinkMarathon(this.bot.bot.api, id);
    } catch {
      // Не вышло сейчас — панель покажет шаги и предложит выбрать канал вручную.
    }
  }

  @Delete('marathons/:id')
  async remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.find(id);
    await this.db.delete(marathons).where(eq(marathons.id, id));
    await this.auth.audit(req.admin ?? null, 'delete', 'marathon', id, {});
    return { ok: true };
  }

  /** Копирует намазы, свои темы, вопросы и варианты. Участницы не переносятся. */
  @Post('marathons/:id/duplicate')
  async duplicate(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = duplicateBody.parse(body ?? {});
    const src = await this.find(id);

    const copy = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(marathons)
        .values({
          ...src,
          id: undefined as never,
          code: `${src.code}_copy_${Date.now().toString(36).slice(-4)}`,
          name: input.name?.trim() || `Копия: ${src.name}`,
          startDate: input.startDate ?? src.startDate,
          endDate: input.endDate ?? src.endDate,
          status: 'draft',
          regOpen: false,
          // Канал у каждого марафона свой: старый не переносим.
          channelLink: input.channelLink,
          channelChatId: null,
          channelTitle: null,
          channelInviteLink: null,
          createdAt: undefined as never,
        })
        .returning();

      const namaz = await tx.select().from(marathonNamaz).where(eq(marathonNamaz.marathonId, id));
      if (namaz.length) {
        await tx.insert(marathonNamaz).values(namaz.map((n) => ({ marathonId: created.id, namazId: n.namazId })));
      }

      const srcTopics = await tx.select().from(topics).where(eq(topics.marathonId, id)).orderBy(asc(topics.position));
      for (const t of srcTopics) {
        const [newTopic] = await tx
          .insert(topics)
          .values({ ...t, id: undefined as never, marathonId: created.id })
          .returning();

        const qs = await tx.select().from(questions).where(eq(questions.topicId, t.id)).orderBy(asc(questions.position));
        for (const q of qs) {
          const [newQ] = await tx
            .insert(questions)
            .values({ ...q, id: undefined as never, topicId: newTopic.id })
            .returning();
          const opts = await tx
            .select()
            .from(questionOptions)
            .where(eq(questionOptions.questionId, q.id))
            .orderBy(asc(questionOptions.position));
          if (opts.length) {
            await tx.insert(questionOptions).values(opts.map((o) => ({ ...o, id: undefined as never, questionId: newQ.id })));
          }
        }
      }
      return created;
    });

    await this.auth.audit(req.admin ?? null, 'duplicate', 'marathon', copy.id, { from: id });
    await this.tryAutoLink(copy.id);
    return { ...copy, channel: await this.channels.summary(copy.id) };
  }

  @Get('marathons/:id/validation')
  async validate(@Param('id') id: string) {
    const issues = await this.validation.validate(id);
    return { issues, blocked: hasBlockingErrors(issues) };
  }

  /** Запуск отклоняется, пока есть ошибки конфигурации. */
  @Post('marathons/:id/launch')
  async launch(@Param('id') id: string, @Req() req: AuthedRequest) {
    const issues = await this.validation.validate(id);
    if (hasBlockingErrors(issues)) {
      throw new BadRequestException({ message: 'Есть ошибки конфигурации', issues });
    }
    const [row] = await this.db.update(marathons).set({ status: 'recruiting', regOpen: true }).where(eq(marathons.id, id)).returning();
    await this.auth.audit(req.admin ?? null, 'launch', 'marathon', id, {});
    return row;
  }

  @Get('namaz')
  async namazLibrary() {
    return this.db.select().from(namazTopics).orderBy(asc(namazTopics.position));
  }

  /** Выключение намаза в идущем марафоне требует подтверждения. */
  @Put('marathons/:id/namaz')
  async setNamaz(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { ids, confirm } = z
      .object({ ids: z.array(z.enum(NAMAZ_IDS as unknown as [string, ...string[]])), confirm: z.boolean().optional() })
      .parse(body);

    const marathon = await this.find(id);
    const current = await this.db.select().from(marathonNamaz).where(eq(marathonNamaz.marathonId, id));
    const removing = current.filter((c) => !ids.includes(c.namazId));

    if (marathon.status === 'running' && removing.length > 0 && !confirm) {
      throw new BadRequestException({
        message: 'Удаление намаза из идущего марафона требует confirm: true',
        removing: removing.map((r) => r.namazId),
      });
    }

    await this.db.transaction(async (tx) => {
      // Панель шлёт весь список целиком, и два быстрых щелчка дают два запроса
      // подряд: без блокировки марафона они удаляют и вставляют одни и те же
      // строки наперегонки и ловят duplicate key. Замок выстраивает их в
      // очередь.
      await tx.execute(sql`select 1 from ${marathons} where ${marathons.id} = ${id} for update`);
      await tx.delete(marathonNamaz).where(eq(marathonNamaz.marathonId, id));
      if (ids.length) {
        await tx
          .insert(marathonNamaz)
          .values(ids.map((namazId) => ({ marathonId: id, namazId })))
          .onConflictDoNothing();
      }
    });

    await this.auth.audit(req.admin ?? null, 'set_namaz', 'marathon', id, { ids });
    await this.replanAll(id);
    return { ids };
  }

  /** Утренняя сводка: каждое число ведёт в отфильтрованный список. */
  @Get('marathons/:id/overview')
  async overview(@Param('id') id: string) {
    await this.find(id);
    const stats = await this.stats(id);

    const active = await this.db
      .select({ id: enrollments.id, tz: participants.tz })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .where(and(eq(enrollments.marathonId, id), eq(enrollments.status, 'active')));

    const byTopic = await this.db
      .select({ topicId: reports.topicId, n: sql<number>`count(*)::int` })
      .from(reports)
      .innerJoin(enrollments, eq(enrollments.id, reports.enrollmentId))
      .where(and(eq(enrollments.marathonId, id), eq(reports.dayKey, toLocalDate(new Date(), 'Asia/Bishkek'))))
      .groupBy(reports.topicId);

    const trend = await this.db
      .select({ dayKey: reports.dayKey, n: sql<number>`count(distinct ${reports.enrollmentId})::int` })
      .from(reports)
      .innerJoin(enrollments, eq(enrollments.id, reports.enrollmentId))
      .where(eq(enrollments.marathonId, id))
      .groupBy(reports.dayKey)
      .orderBy(asc(reports.dayKey));

    return { ...stats, activeCount: active.length, byTopic, trend };
  }

  /* ───────── общее ───────── */

  private async find(id: string) {
    const [row] = await this.db.select().from(marathons).where(eq(marathons.id, id)).limit(1);
    if (!row) throw new NotFoundException('Марафон не найден');
    return row;
  }

  /** Сколько своих тем в марафоне — для карточки в списке. */
  private async topicsCount(marathonId: string): Promise<number> {
    const rows = await this.db.select({ id: topics.id }).from(topics).where(eq(topics.marathonId, marathonId));
    return rows.length;
  }

  /** Включённые намазы, в каноническом порядке библиотеки. */
  private async namazIds(marathonId: string): Promise<string[]> {
    const rows = await this.db.select().from(marathonNamaz).where(eq(marathonNamaz.marathonId, marathonId));
    const order = new Map(NAMAZ_IDS.map((id, i) => [id as string, i]));
    return rows
      .map((r) => r.namazId as string)
      .sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }

  private async stats(marathonId: string) {
    const rows = await this.db
      .select({
        enrollmentId: enrollments.id,
        status: enrollments.status,
        tz: participants.tz,
        joinedAt: enrollments.joinedAt,
      })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .where(eq(enrollments.marathonId, marathonId));

    const active = rows.filter((r) => r.status === 'active');
    const ids = active.map((r) => r.enrollmentId);

    const todayRows = ids.length
      ? await this.db
          .select({ enrollmentId: reports.enrollmentId, dayKey: reports.dayKey })
          .from(reports)
          .where(inArray(reports.enrollmentId, ids))
      : [];

    const tzOf = new Map(active.map((r) => [r.enrollmentId, r.tz ?? 'Asia/Bishkek']));
    const submittedToday = new Set<string>();
    let reportsToday = 0;

    for (const r of todayRows) {
      const tz = tzOf.get(r.enrollmentId);
      if (tz && r.dayKey === toLocalDate(new Date(), tz)) {
        submittedToday.add(r.enrollmentId);
        reportsToday++;
      }
    }

    const newToday = active.filter((r) => toLocalDate(r.joinedAt, r.tz ?? 'Asia/Bishkek') === toLocalDate(new Date(), r.tz ?? 'Asia/Bishkek'));

    return {
      total: rows.length,
      active: active.length,
      submittedToday: submittedToday.size,
      pct: active.length ? Math.round((submittedToday.size / active.length) * 100) : 0,
      reportsToday,
      newToday: newToday.length,
      newTodaySubmitted: newToday.filter((r) => submittedToday.has(r.enrollmentId)).length,
    };
  }

  /** После смены состава тем расписание дня нужно пересобрать. */
  private async replanAll(marathonId: string): Promise<void> {
    const rows = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.marathonId, marathonId), eq(enrollments.status, 'active')));
    for (const r of rows) await this.planner.replanToday(r.id).catch(() => {});
  }
}
