import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Update } from 'grammy/types';
import { BotModule } from '../../src/bot/bot.module';
import { BotService } from '../../src/bot/bot.service';
import { DRIZZLE, DrizzleModule, PG_POOL, type Db } from '../../src/db/drizzle.module';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../src/db/schema';
import { ServicesModule } from '../../src/services/services.module';

/**
 * Стенд для сквозных тестов бота: настоящий Postgres и поддельный Telegram API.
 * Исходящие вызовы перехватываются трансформером — ничего наружу не уходит.
 */

export interface SentCall {
  method: string;
  payload: Record<string, unknown>;
}

export interface Harness {
  bot: BotService;
  db: Db;
  sent: SentCall[];
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

  // DrizzleModule глобальный, поэтому его достаточно импортировать один раз;
  // подменяем провайдеры, чтобы тест работал на своём пуле и закрывал его сам.
  const moduleRef = await Test.createTestingModule({ imports: [DrizzleModule, ServicesModule, BotModule] })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(DRIZZLE)
    .useValue(db)
    .compile();

  const bot = moduleRef.get(BotService);

  const sent: SentCall[] = [];
  bot.bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
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

  let updateId = 1000;

  return {
    bot,
    db,
    sent,
    lastText: () => {
      const msgs = sent.filter((c) => c.method === 'sendMessage');
      return String(msgs[msgs.length - 1]?.payload.text ?? '');
    },
    texts: () => sent.filter((c) => c.method === 'sendMessage').map((c) => String(c.payload.text ?? '')),
    reset: () => {
      sent.length = 0;
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

/** Убирает участницу и всё, что к ней привязано, между тестами. */
export async function wipeTestParticipant(db: Db): Promise<void> {
  const [p] = await db.select().from(schema.participants).where(eq(schema.participants.tgUserId, TEST_TG_USER_ID)).limit(1);
  if (!p) return;
  await db.delete(schema.participants).where(eq(schema.participants.id, p.id));
  await db.delete(schema.botSessions).where(eq(schema.botSessions.key, TEST_TG_USER_ID));
}
