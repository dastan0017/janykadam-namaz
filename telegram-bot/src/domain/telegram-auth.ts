import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка данных Telegram Login Widget.
 *
 * Ключ — SHA256 от токена бота (для Login Widget; у Mini Apps схема другая).
 * Подпись считается по строке из отсортированных пар key=value без самого hash.
 */

export interface TelegramAuthPayload {
  id: string | number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string | number;
  hash: string;
  [key: string]: unknown;
}

export type AuthFailure = 'bad_hash' | 'expired' | 'malformed';

export interface AuthResult {
  ok: boolean;
  reason?: AuthFailure;
  tgUserId?: string;
  username?: string;
  firstName?: string;
}

/** Данные старше суток не принимаем. */
export const MAX_AUTH_AGE_SEC = 24 * 60 * 60;

export function buildDataCheckString(payload: Record<string, unknown>): string {
  return Object.keys(payload)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${String(payload[k])}`)
    .join('\n');
}

export function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string,
  now: Date = new Date(),
): AuthResult {
  if (!payload?.hash || payload.id === undefined || payload.auth_date === undefined) {
    return { ok: false, reason: 'malformed' };
  }

  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(buildDataCheckString(payload)).digest('hex');

  const given = Buffer.from(String(payload.hash), 'hex');
  const want = Buffer.from(expected, 'hex');
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: 'bad_hash' };
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'malformed' };
  if (Math.floor(now.getTime() / 1000) - authDate > MAX_AUTH_AGE_SEC) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    tgUserId: String(payload.id),
    username: payload.username,
    firstName: payload.first_name,
  };
}

/** Подписывает данные тем же способом — нужно тестам и отладке. */
export function signTelegramAuth(payload: Omit<TelegramAuthPayload, 'hash'>, botToken: string): string {
  const secret = createHash('sha256').update(botToken).digest();
  return createHmac('sha256', secret).update(buildDataCheckString(payload)).digest('hex');
}
