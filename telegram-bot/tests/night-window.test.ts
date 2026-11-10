import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { reports } from '../src/db/schema';
import {
  callbackUpdate, enrollmentOf, lastButtons, makeHarness, registerInBishkek,
  videoNoteUpdate, wipeTestParticipant, type Harness,
} from './helpers/bot-harness';

/**
 * Пункт 14.7 чек-листа: окно, пересекающее полночь.
 *
 * Куптан 8 ноября в Бишкеке открывается в 19:06 и действует до фаджра 9 ноября
 * (06:20). Кружок, отправленный в 01:00 ночи, относится к ключу дня 2026-11-08,
 * а не к календарной дате отправки.
 *
 * Ночью открыты сразу две темы с разными ключами дня: Куптан относится к дате
 * своей иши, Тахажуд — к дате своего фаджра. Это закреплено тестом, чтобы его
 * не «починили» по ошибке.
 */

/** 09:40 по Бишкеку 8 ноября — момент регистрации. */
const AT_0940 = new Date('2026-11-08T03:40:00Z');
/** 01:00 по Бишкеку 9 ноября. */
const AT_0100_NEXT = new Date('2026-11-08T19:00:00Z');
/** 04:00 по Бишкеку 9 ноября: Тахажуд уже открыт (с 03:50). */
const AT_0400_NEXT = new Date('2026-11-08T22:00:00Z');

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  vi.useRealTimers();
  await h.close();
});

afterEach(async () => {
  vi.useRealTimers();
  await wipeTestParticipant(h.db);
  h.reset();
});

describe('Куптан через полночь', () => {
  it('кружок в 01:00 засчитывается за предыдущий день', async () => {
    vi.useFakeTimers({ now: AT_0940, toFake: ['Date'] });
    await registerInBishkek(h, AT_0940);

    vi.setSystemTime(AT_0100_NEXT);
    h.reset();
    await h.feed(videoNoteUpdate({ fileUniqueId: 'nw_isha', at: AT_0100_NEXT }));

    // Открыт ровно один Куптан, поэтому тема назначается без вопроса.
    const all = h.texts().join('\n');
    expect(all).toContain('Куптан');
    expect(all).toMatch(/кабыл алынды|отчёт принят/);

    const e = await enrollmentOf(h.db);
    const rows = await h.db.select().from(reports).where(eq(reports.enrollmentId, e.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].topicId).toBe('t6');
    expect(rows[0].dayKey).toBe('2026-11-08');
    expect(rows[0].pointsAwarded).toBe(10);
    // Отправлено 9 ноября, а окно принадлежит восьмому.
    expect(rows[0].submittedAt.toISOString()).toBe(AT_0100_NEXT.toISOString());
  });

  it('в 04:00 открыты Куптан и Тахажуд, и у них разные ключи дня', async () => {
    vi.useFakeTimers({ now: AT_0940, toFake: ['Date'] });
    await registerInBishkek(h, AT_0940);

    vi.setSystemTime(AT_0400_NEXT);
    h.reset();
    await h.feed(videoNoteUpdate({ fileUniqueId: 'nw_both', at: AT_0400_NEXT }));

    const buttons = lastButtons(h);
    expect(buttons.some((b) => b.text.includes('Куптан'))).toBe(true);
    expect(buttons.some((b) => b.text.includes('Тахажуд'))).toBe(true);

    // Сдаём Тахажуд: он относится к 9 ноября.
    const tahajjud = buttons.find((b) => b.text.includes('Тахажуд'))!;
    await h.feed(callbackUpdate(tahajjud.callback_data));

    // Второй кружок: открытым остался только Куптан — он восьмого числа.
    h.reset();
    await h.feed(videoNoteUpdate({ fileUniqueId: 'nw_isha2', at: AT_0400_NEXT }));
    expect(h.texts().join('\n')).toMatch(/кабыл алынды|отчёт принят/);

    const e = await enrollmentOf(h.db);
    const rows = await h.db
      .select()
      .from(reports)
      .where(eq(reports.enrollmentId, e.id))
      .orderBy(asc(reports.dayKey));

    expect(rows.map((r) => [r.topicId, r.dayKey])).toEqual([
      ['t6', '2026-11-08'],
      ['t1', '2026-11-09'],
    ]);
  });
});
