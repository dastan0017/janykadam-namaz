import { describe, expect, it } from 'vitest';
import { buildDataCheckString, signTelegramAuth, verifyTelegramAuth } from '../src/domain/telegram-auth';

// Заведомо ненастоящий токен: подпись проверяется тем же значением, им и подписана.
// Похожий на настоящий токен-пример из документации Telegram ловил сканер секретов GitHub.
const TOKEN = '123456:TEST_TOKEN_PLACEHOLDER_FOR_LOCAL_DEV';

function payload(overrides: Record<string, unknown> = {}) {
  const base = {
    id: 42,
    first_name: 'Жазгүл',
    username: 'jazgul_a',
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  return { ...base, hash: signTelegramAuth(base, TOKEN) };
}

describe('строка для подписи', () => {
  it('сортирует ключи и исключает hash', () => {
    const s = buildDataCheckString({ b: 2, a: 1, hash: 'x', c: 3 });
    expect(s).toBe('a=1\nb=2\nc=3');
  });
});

describe('проверка подписи Telegram Login', () => {
  it('корректные данные принимаются', () => {
    const r = verifyTelegramAuth(payload(), TOKEN);
    expect(r.ok).toBe(true);
    expect(r.tgUserId).toBe('42');
    expect(r.username).toBe('jazgul_a');
  });

  it('подделанное поле ломает подпись', () => {
    const p = payload();
    p.username = 'someone_else';
    expect(verifyTelegramAuth(p, TOKEN)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('чужой токен не проходит', () => {
    expect(verifyTelegramAuth(payload(), '999:OTHER').reason).toBe('bad_hash');
  });

  it('данные старше суток отклоняются', () => {
    const old = Math.floor(Date.now() / 1000) - 25 * 3600;
    expect(verifyTelegramAuth(payload({ auth_date: old }), TOKEN)).toEqual({ ok: false, reason: 'expired' });
  });

  it('ровно на границе суток ещё принимается', () => {
    const edge = Math.floor(Date.now() / 1000) - 24 * 3600 + 5;
    expect(verifyTelegramAuth(payload({ auth_date: edge }), TOKEN).ok).toBe(true);
  });

  it('без hash или id — malformed', () => {
    expect(verifyTelegramAuth({ id: 1, auth_date: 1 } as never, TOKEN).reason).toBe('malformed');
    expect(verifyTelegramAuth({ hash: 'ab', auth_date: 1 } as never, TOKEN).reason).toBe('malformed');
  });

  it('мусорный hash не роняет проверку', () => {
    const p = payload();
    p.hash = 'не-шестнадцатеричное';
    expect(verifyTelegramAuth(p, TOKEN).ok).toBe(false);
  });
});
