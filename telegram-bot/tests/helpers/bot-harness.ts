import { Test } from '@nestjs/testing';
import { autoRetry } from '@grammyjs/auto-retry';
import { and, eq, like } from 'drizzle-orm';
import type { ApiResponse, Update } from 'grammy/types';
import { BotModule } from '../../src/bot/bot.module';
import { BotService } from '../../src/bot/bot.service';
import { DRIZZLE, DrizzleModule, PG_POOL, type Db } from '../../src/db/drizzle.module';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../src/db/schema';
import { BossService } from '../../src/jobs/boss.service';
import { BroadcastWorker } from '../../src/jobs/broadcast.worker';
import { ChannelWorker } from '../../src/jobs/channel.worker';
import { JobsModule } from '../../src/jobs/jobs.module';
import { PlannerService } from '../../src/jobs/planner.service';
import { BroadcastService } from '../../src/services/broadcast.service';
import { NotifyService } from '../../src/services/notify.service';
import { SettingsService } from '../../src/services/settings.service';
import { WorkersService } from '../../src/jobs/workers.service';
import { ServicesModule } from '../../src/services/services.module';

/**
 * Стенд для сквозных тестов бота: настоящий Postgres и поддельный Telegram API.
 * Исходящие вызовы перехватываются трансформером — ничего наружу не уходит.
 *
 * pg-boss тоже поддельный: задания не исполняются по расписанию, а складываются
 * в `jobs`, а воркеры и планировщик вызываются из теста напрямую. Так проверяется
 * и что поставлено в очередь, и что произойдёт, когда задание сработает.
 */

export type { Db };

export interface SentCall {
  method: string;
  payload: Record<string, unknown>;
}

/** Задание, поставленное в очередь планировщиком. */
export interface SentJob {
  name: string;
  data: Record<string, unknown>;
  opts: { startAfter?: Date; singletonKey?: string };
}

/**
 * Подменяет ответ Telegram. Возвращает `undefined` — пусть вызов пройдёт как
 * обычно; возвращает ответ — он и уйдёт в grammY, в том числе `ok: false`.
 */
export type Intercept = (call: SentCall) => ApiResponse<unknown> | undefined;

export interface Harness {
  bot: BotService;
  db: Db;
  sent: SentCall[];
  /** Задания, поставленные в поддельный pg-boss. */
  jobs: SentJob[];
  workers: WorkersService;
  planner: PlannerService;
  broadcasts: BroadcastWorker;
  /** Канал марафона: приглашения, исключённые и публикация отчётов. */
  channel: ChannelWorker;
  broadcastSvc: BroadcastService;
  notify: NotifyService;
  /** Настройки бота — тестам, которым нужен, например, свой лимит напоминаний. */
  settings: SettingsService;
  /** Подмена ответов Telegram: 403, 429 и прочее. */
  setIntercept(fn: Intercept | undefined): void;
  /** Текст последнего отправленного сообщения. */
  lastText(): string;
  /** Все тексты, отправленные с момента вызова reset(). */
  texts(): string[];
  reset(): void;
  feed(update: Partial<Update> & { update_id?: number }): Promise<void>;
  close(): Promise<void>;
}

const DB_URL = process.env.DATABASE_URL ?? 'postgres://janykadam:janykadam@localhost:5433/janykadam';

export async function makeHarness(): Promise<Harness> {
  process.env.BOT_TOKEN ??= '123456:TEST_TOKEN_PLACEHOLDER_FOR_LOCAL_DEV';
  process.env.DATABASE_URL = DB_URL;
  process.env.SESSION_SECRET ??= '0123456789abcdef0123456789abcdef';
  process.env.TZ = 'UTC';

  const pool = new Pool({ connectionString: DB_URL });
  const db = drizzle(pool, { schema });

  const jobs: SentJob[] = [];
  const boss = fakeBoss(jobs);

  // DrizzleModule глобальный, поэтому его достаточно импортировать один раз;
  // подменяем провайдеры, чтобы тест работал на своём пуле и закрывал его сам.
  const moduleRef = await Test.createTestingModule({
    imports: [DrizzleModule, ServicesModule, BotModule, JobsModule],
  })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(DRIZZLE)
    .useValue(db)
    .overrideProvider(BossService)
    .useValue(boss)
    .compile();

  const bot = moduleRef.get(BotService);

  const sent: SentCall[] = [];
  let intercept: Intercept | undefined;

  bot.bot.api.config.use(async (_prev, method, payload) => {
    const call = { method, payload: payload as Record<string, unknown> };
    sent.push(call);

    const custom = intercept?.(call);
    if (custom) return custom as never;

    // Правдоподобные ответы, чтобы grammY не спотыкался.
    if (method === 'sendMessage') {
      return {
        ok: true,
        result: {
          message_id: sent.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1, type: 'private' },
          text: String((payload as { text?: string }).text ?? ''),
        },
      } as never;
    }
    return { ok: true, result: true } as never;
  });

  // В grammY последний установленный трансформер — самый внешний, поэтому
  // поддельный транспорт выше autoRetry из BotService, и 429 до него не дошёл
  // бы. Ставим autoRetry ещё раз, уже над подменой: так в тесте работает тот
  // же плагин с теми же настройками, что и в проде.
  bot.bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  // Без обращения к Telegram за собственным профилем.
  bot.bot.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: 'Janykadam',
    username: 'janykadam_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };

  // init() намеренно не вызываем: тогда воркеры не подписываются даже на
  // поддельную очередь и срабатывают только когда их позовёт тест.
  let updateId = 1000;

  return {
    bot,
    db,
    sent,
    jobs,
    workers: moduleRef.get(WorkersService),
    planner: moduleRef.get(PlannerService),
    broadcasts: moduleRef.get(BroadcastWorker),
    channel: moduleRef.get(ChannelWorker),
    broadcastSvc: moduleRef.get(BroadcastService),
    notify: moduleRef.get(NotifyService),
    settings: moduleRef.get(SettingsService),
    setIntercept: (fn) => {
      intercept = fn;
    },
    lastText: () => {
      const msgs = sent.filter((c) => c.method === 'sendMessage');
      return String(msgs[msgs.length - 1]?.payload.text ?? '');
    },
    texts: () => sent.filter((c) => c.method === 'sendMessage').map((c) => String(c.payload.text ?? '')),
    reset: () => {
      sent.length = 0;
      jobs.length = 0;
      intercept = undefined;
    },
    feed: async (update) => {
      await bot.bot.handleUpdate({ update_id: update.update_id ?? ++updateId, ...update } as Update);
    },
    close: async () => {
      await moduleRef.close();
      await pool.end();
    },
  };
}

/**
 * Поддельный pg-boss: `send` складывает задание в массив, остальное — заглушки.
 * Расписания и воркеры регистрируются, но ничего не исполняют.
 */
function fakeBoss(jobs: SentJob[]) {
  const instance = {
    on: () => undefined,
    start: async () => undefined,
    createQueue: async () => undefined,
    work: async () => 'worker',
    schedule: async () => undefined,
    getQueue: async () => ({ name: 'plan-day' }),
    stop: async () => undefined,
    send: async (name: string, data: Record<string, unknown>, opts: SentJob['opts'] = {}) => {
      jobs.push({ name, data, opts });
      return 'job';
    },
  };

  return {
    start: async () => instance,
    get instance() {
      return instance;
    },
    healthy: async () => true,
    onApplicationShutdown: async () => undefined,
  };
}

/* ───────── конструкторы апдейтов ───────── */

const USER = { id: 777001, is_bot: false, first_name: 'Айсулуу', username: 'aisuluu_test', language_code: 'ky' };
const CHAT = { id: 777001, type: 'private' as const, first_name: 'Айсулуу' };

export const TEST_TG_USER_ID = String(USER.id);

export function textUpdate(text: string, at: Date = new Date()): Partial<Update> {
  return {
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      date: Math.floor(at.getTime() / 1000),
      chat: CHAT,
      from: USER,
      text,
      entities: text.startsWith('/')
        ? [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0].length }]
        : undefined,
    },
  } as Partial<Update>;
}

export function videoNoteUpdate(opts: { fileUniqueId: string; at: Date; forwarded?: boolean }): Partial<Update> {
  return {
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      date: Math.floor(opts.at.getTime() / 1000),
      chat: CHAT,
      from: USER,
      video_note: {
        file_id: `file_${opts.fileUniqueId}`,
        file_unique_id: opts.fileUniqueId,
        length: 384,
        duration: 12,
      },
      ...(opts.forwarded
        ? { forward_origin: { type: 'user', date: 0, sender_user: { id: 999, is_bot: false, first_name: 'Кто-то' } } }
        : {}),
    },
  } as Partial<Update>;
}

export function photoUpdate(at: Date = new Date()): Partial<Update> {
  return {
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      date: Math.floor(at.getTime() / 1000),
      chat: CHAT,
      from: USER,
      photo: [{ file_id: 'photo1', file_unique_id: 'pu1', width: 100, height: 100 }],
    },
  } as Partial<Update>;
}

export function callbackUpdate(data: string): Partial<Update> {
  return {
    callback_query: {
      id: String(Math.floor(Math.random() * 1e9)),
      from: USER,
      chat_instance: 'ci',
      data,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: CHAT,
        from: { id: 123456, is_bot: true, first_name: 'bot' },
        text: 'x',
      },
    },
  } as Partial<Update>;
}

/** Регистрация в демо-марафоне m5 с пресетом Бишкека. */
export async function registerInBishkek(h: Harness, at: Date): Promise<void> {
  await h.feed(textUpdate('/start m5', at));
  await h.feed(callbackUpdate('lang:kg'));
  // Кнопка пресета приходит обычным текстом реплай-клавиатуры.
  await h.feed(textUpdate('Бишкек · UTC+6', at));
  // Без согласия с правилами записи в марафон не будет.
  await h.feed(callbackUpdate('rules:yes'));
  // Цель спрашивается до приветствия — откладываем её.
  await h.feed(callbackUpdate('goal:later'));
}

/** Запись тестовой участницы, зарегистрированной через бота. */
export async function enrollmentOf(db: Db, tgUserId: string = TEST_TG_USER_ID) {
  const [p] = await db.select().from(schema.participants).where(eq(schema.participants.tgUserId, tgUserId)).limit(1);
  if (!p?.activeEnrollmentId) throw new Error('У участницы нет активной записи');
  const [e] = await db.select().from(schema.enrollments).where(eq(schema.enrollments.id, p.activeEnrollmentId)).limit(1);
  return e;
}

/** Достаёт кнопки инлайн-клавиатуры последнего сообщения. */
export function lastButtons(h: Harness): { text: string; callback_data: string }[] {
  const last = h.sent.filter((c) => c.method === 'sendMessage').at(-1);
  const kb = last?.payload.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined;
  return (kb?.inline_keyboard ?? []).flat();
}

/* ───────── участницы прямо в базе ───────── */

export interface MadeParticipant {
  participantId: string;
  enrollmentId: string;
  tgUserId: string;
  chatId: string;
}

/** Координаты и пояс Бишкека — те же, что у пресета в сиде. */
export const BISHKEK = { lat: 42.87, lng: 74.59, tz: 'Asia/Bishkek' };
/** Манхэттен: нужен для проверки перехода на зимнее время. */
export const NEW_YORK = { lat: 40.75, lng: -73.98, tz: 'America/New_York' };

export async function marathonIdByCode(db: Db, code: string): Promise<string> {
  const [m] = await db.select().from(schema.marathons).where(eq(schema.marathons.code, code)).limit(1);
  if (!m) throw new Error(`Нет марафона с кодом ${code}: выполните seed с SEED_DEMO=true`);
  return m.id;
}

/**
 * Создаёт участницу с записью в марафон минуя бота: часть проверок начинается
 * с того, что участница уже зарегистрирована неделю назад.
 */
export async function makeParticipant(
  db: Db,
  opts: {
    tgUserId: string;
    marathonCode?: string;
    place?: { lat: number; lng: number; tz: string };
    lang?: 'kg' | 'ru';
    joinedAt?: Date;
    status?: 'active' | 'paused' | 'finished' | 'left';
    tahajjud?: boolean;
    blocked?: boolean;
    streak?: number;
    bestStreak?: number;
    points?: number;
  },
): Promise<MadeParticipant> {
  const place = opts.place ?? BISHKEK;
  const marathonId = await marathonIdByCode(db, opts.marathonCode ?? 'm5');

  const [p] = await db
    .insert(schema.participants)
    .values({
      tgUserId: opts.tgUserId,
      chatId: opts.tgUserId,
      firstName: 'Тест',
      lang: opts.lang ?? 'kg',
      lat: place.lat,
      lng: place.lng,
      tz: place.tz,
      placeLabel: 'Тестовое место',
      locationSource: 'preset',
      blocked: opts.blocked ?? false,
      tahajjudReminders: opts.tahajjud ?? false,
    })
    .returning();

  const [e] = await db
    .insert(schema.enrollments)
    .values({
      participantId: p.id,
      marathonId,
      status: opts.status ?? 'active',
      joinedAt: opts.joinedAt ?? new Date('2026-10-21T00:00:00Z'),
      streak: opts.streak ?? 0,
      // Лучшая серия не может быть меньше текущей.
      bestStreak: opts.bestStreak ?? opts.streak ?? 0,
      points: opts.points ?? 0,
    })
    .returning();

  await db
    .update(schema.participants)
    .set({ activeEnrollmentId: e.id })
    .where(eq(schema.participants.id, p.id));

  return { participantId: p.id, enrollmentId: e.id, tgUserId: opts.tgUserId, chatId: opts.tgUserId };
}

/** Убирает участницу и всё, что к ней привязано, между тестами. */
export async function wipeTestParticipant(db: Db): Promise<void> {
  await wipeParticipants(db, TEST_TG_USER_ID);
}

/**
 * Убирает всех участниц, чей tgUserId начинается с префикса. Каскады уносят
 * записи, отчёты, журнал напоминаний и доставки рассылок.
 */
export async function wipeParticipants(db: Db, prefix: string): Promise<void> {
  await db.delete(schema.participants).where(like(schema.participants.tgUserId, `${prefix}%`));
  await db.delete(schema.botSessions).where(like(schema.botSessions.key, `${prefix}%`));
}

/** Готовый отчёт прямо в базе: нужен, когда проверяется не приём, а оценка дня. */
export async function insertReport(
  db: Db,
  opts: { enrollmentId: string; topicId: string; dayKey: string; points?: number; late?: boolean },
): Promise<void> {
  const at = new Date(`${opts.dayKey}T12:00:00Z`);
  await db
    .insert(schema.reports)
    .values({
      enrollmentId: opts.enrollmentId,
      topicKind: 'namaz',
      topicId: opts.topicId,
      dayKey: opts.dayKey,
      windowOpensAt: at,
      windowClosesAt: new Date(at.getTime() + 3600_000),
      submittedAt: at,
      late: opts.late ?? false,
      videoFileId: `f_${opts.enrollmentId}_${opts.topicId}_${opts.dayKey}`,
      videoFileUniqueId: `u_${opts.enrollmentId}_${opts.topicId}_${opts.dayKey}`,
      pointsAwarded: opts.points ?? 10,
    })
    .onConflictDoNothing();
}

/** Сколько напоминаний записано в журнал — журнал и есть защита от повторов. */
export async function remindersCount(db: Db, enrollmentId: string, dayKey: string): Promise<number> {
  const rows = await db
    .select({ id: schema.remindersLog.id })
    .from(schema.remindersLog)
    .where(and(eq(schema.remindersLog.enrollmentId, enrollmentId), eq(schema.remindersLog.dayKey, dayKey)));
  return rows.length;
}
