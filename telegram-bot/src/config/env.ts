import { z } from 'zod';
import { loadDotenv } from './dotenv';

/**
 * Разбор окружения. Падаем на старте, а не в середине работы.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  BOT_TOKEN: z.string().min(10, 'BOT_TOKEN обязателен'),
  DATABASE_URL: z.string().url(),

  /** Публичный адрес для вебхука. В режиме polling не нужен. */
  PUBLIC_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().min(16).optional(),
  /** webhook в проде, polling в разработке. */
  BOT_MODE: z.enum(['webhook', 'polling']).default('polling'),

  SESSION_SECRET: z.string().min(16),
  /** Origin админ-панели для CORS. */
  ADMIN_ORIGIN: z.string().url().optional(),

  INITIAL_ADMIN_TG_USERNAME: z.string().optional(),
  SEED_DEMO: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Общий предел отправки, сообщений в секунду. У Telegram он около 30 на все
   * чаты, поэтому по умолчанию держим 25 с запасом. Ниже — если Telegram начнёт
   * возвращать 429; выше имеет смысл только в тестах, где Telegram поддельный.
   */
  MAX_MSG_PER_SECOND: z.coerce.number().int().positive().default(25),

  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  TZ: z.literal('UTC', { message: 'Процесс обязан работать с TZ=UTC' }).default('UTC'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `.env` имеет приоритет над окружением оболочки — см. loadDotenv.
  if (source === process.env) loadDotenv();

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(корень)'}: ${i.message}`).join('\n');
    throw new Error(`Некорректное окружение:\n${issues}`);
  }

  const env = parsed.data;

  // Весь расчёт времени опирается на то, что процесс живёт в UTC.
  if (env.TZ !== 'UTC') throw new Error('Процесс обязан работать с TZ=UTC');
  if (new Date().getTimezoneOffset() !== 0) {
    throw new Error('Смещение процесса не нулевое — запускайте с TZ=UTC');
  }

  if (env.BOT_MODE === 'webhook') {
    if (!env.PUBLIC_URL) throw new Error('В режиме webhook нужен PUBLIC_URL');
    if (!env.WEBHOOK_SECRET) throw new Error('В режиме webhook нужен WEBHOOK_SECRET');
  }

  return env;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}
