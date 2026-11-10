import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pointsLedger, reportDrafts, reports } from '../src/db/schema';
import {
  callbackUpdate, enrollmentOf, lastButtons, makeHarness, registerInBishkek,
  videoNoteUpdate, wipeTestParticipant, type Harness,
} from './helpers/bot-harness';

/**
 * Пункт 14.6 чек-листа: поздняя сдача.
 *
 * В 09:40 по Бишкеку 8 ноября закрыты два окна этого дня — Тахажуд (до 06:18)
 * и Багымдат (06:18–07:44). Оба попадают в поздние кандидаты: поздняя сдача
 * доступна, пока день ещё можно оценить, то есть до следующего фаджра.
 * У марафона m5 две попытки — проверяем, что обе тратятся и третьей нет.
 */

/** 2026-11-08, 09:40 по Бишкеку = 03:40 UTC. */
const AT_0940 = new Date('2026-11-08T03:40:00Z');

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

/** Отправляет кружок и возвращает кнопку поздней сдачи по названию темы. */
async function offerLate(fileUniqueId: string, topic: string) {
  await h.feed(videoNoteUpdate({ fileUniqueId, at: AT_0940 }));
  const button = lastButtons(h).find((b) => b.text.includes('⏰') && b.text.includes(topic));
  expect(button, `тема «${topic}» предложена как поздняя`).toBeTruthy();
  h.reset();
  await h.feed(callbackUpdate(button!.callback_data));
  return button!;
}

describe('поздняя сдача', () => {
  it('закрытое окно предлагается отдельно, с остатком попыток', async () => {
    vi.useFakeTimers({ now: AT_0940, toFake: ['Date'] });
    await registerInBishkek(h, AT_0940);
    h.reset();

    await h.feed(videoNoteUpdate({ fileUniqueId: 'lp_offer', at: AT_0940 }));
    const buttons = lastButtons(h);

    // Открытые окна показаны со временем закрытия, поздние — с часами.
    expect(buttons.some((b) => b.text.includes('Зикир') && !b.text.includes('⏰'))).toBe(true);
    const late = buttons.filter((b) => b.text.includes('⏰')).map((b) => b.text);
    expect(late.some((t) => t.includes('Багымдат'))).toBe(true);
    expect(late.some((t) => t.includes('Тахажуд'))).toBe(true);
    // Пешим откроется только в 12:45 — ни среди открытых, ни среди поздних.
    expect(buttons.some((b) => b.text.includes('Пешим'))).toBe(false);
  });

  it('согласие тратит попытку, отчёт помечен поздним и попадает в день окна', async () => {
    vi.useFakeTimers({ now: AT_0940, toFake: ['Date'] });
    await registerInBishkek(h, AT_0940);
    h.reset();

    await offerLate('lp_yes', 'Багымдат');

    // Вопрос о поздней сдаче называет тему и остаток попыток.
    const offer = h.texts().join('\n');
    expect(offer).toContain('Багымдат');
    expect(offer).toMatch(/\b2\b/);

    h.reset();
    await h.feed(callbackUpdate('late:yes'));
    expect(h.texts().join('\n')).toMatch(/кабыл алынды|отчёт принят/);

    const e = await enrollmentOf(h.db);
    expect(e.latePassesUsed).toBe(1);
    expect(e.points).toBe(10);

    const rows = await h.db.select().from(reports).where(eq(reports.enrollmentId, e.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].late).toBe(true);
    expect(rows[0].topicId).toBe('t2');
    // Ключ дня — у окна, а не у момента отправки; здесь они совпадают.
    expect(rows[0].dayKey).toBe('2026-11-08');
    expect(rows[0].pointsAwarded).toBe(10);

    const ledger = await h.db.select().from(pointsLedger).where(eq(pointsLedger.enrollmentId, e.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(10);
  });

  it('отказ не тратит попытку и не оставляет черновика', async () => {
    vi.useFakeTimers({ now: AT_0940, toFake: ['Date'] });
    await registerInBishkek(h, AT_0940);
    h.reset();

    await offerLate('lp_no', 'Багымдат');
    await h.feed(callbackUpdate('late:no'));

    const e = await enrollmentOf(h.db);
    expect(e.latePassesUsed).toBe(0);
    expect(e.points).toBe(0);

    expect(await h.db.select().from(reports).where(eq(reports.enrollmentId, e.id))).toHaveLength(0);
    expect(await h.db.select().from(reportDrafts).where(eq(reportDrafts.enrollmentId, e.id))).toHaveLength(0);
  });

  it('две попытки расходуются, третьего предложения нет', async () => {
    vi.useFakeTimers({ now: AT_0940, toFake: ['Date'] });
    await registerInBishkek(h, AT_0940);
    h.reset();

    await offerLate('lp_1', 'Багымдат');
    await h.feed(callbackUpdate('late:yes'));
    expect((await enrollmentOf(h.db)).latePassesUsed).toBe(1);

    // Вторая попытка: Багымдат уже сдан, в поздних остался Тахажуд.
    await offerLate('lp_2', 'Тахажуд');
    expect(h.texts().join('\n')).toMatch(/\b1\b/);
    await h.feed(callbackUpdate('late:yes'));

    const e = await enrollmentOf(h.db);
    expect(e.latePassesUsed).toBe(2);
    // Тахажуд стоит 15 баллов, Багымдат — 10.
    expect(e.points).toBe(25);

    // Третий кружок: поздних кандидатов больше нет, остались только открытые.
    h.reset();
    await h.feed(videoNoteUpdate({ fileUniqueId: 'lp_3', at: AT_0940 }));
    const buttons = lastButtons(h);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.some((b) => b.text.includes('⏰'))).toBe(false);
  });
});
