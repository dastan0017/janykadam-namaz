import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { enrollments, excusedDays, pointsLedger } from '../src/db/schema';
import {
  BISHKEK, insertReport, makeHarness, makeParticipant, wipeParticipants,
  type Db, type Harness, type MadeParticipant,
} from './helpers/bot-harness';

/**
 * Пункт 14.10 чек-листа: полный день и серия.
 *
 * День оценивается, когда закрылось последнее обязательное окно — для Куптана
 * это следующий фаджр. Обязательные темы m5 — пять намазов: t2…t6.
 *
 * Три случая делают день полным без отчётов: уважительный день, пауза и день
 * регистрации, в котором окна, открывшиеся до входа, не требуются.
 */

const TG_PREFIX = '9130';
const DAY = '2026-11-08';
/** Момент оценки: фаджр 9 ноября в Бишкеке уже наступил. */
const AT_EVAL = new Date('2026-11-09T00:30:00Z');
const MANDATORY = ['t2', 't3', 't4', 't5', 't6'];

let h: Harness;
let seq = 0;

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  vi.useRealTimers();
  await h.close();
});

afterEach(async () => {
  vi.useRealTimers();
  await wipeParticipants(h.db, TG_PREFIX);
  h.reset();
});

async function given(
  opts: { status?: 'active' | 'paused'; joinedAt?: Date; streak?: number; points?: number } = {},
): Promise<MadeParticipant> {
  vi.useFakeTimers({ now: AT_EVAL, toFake: ['Date'] });
  const made = await makeParticipant(h.db, {
    tgUserId: `${TG_PREFIX}${String(++seq).padStart(2, '0')}`,
    place: BISHKEK,
    joinedAt: opts.joinedAt ?? new Date('2026-10-21T00:00:00Z'),
    status: opts.status,
    streak: opts.streak,
    points: opts.points,
  });
  h.reset();
  return made;
}

/** Отчёты по перечисленным темам за день. */
async function report(db: Db, enrollmentId: string, topicIds: string[]): Promise<void> {
  for (const topicId of topicIds) await insertReport(db, { enrollmentId, topicId, dayKey: DAY });
}

async function enrollmentById(id: string) {
  const [row] = await h.db.select().from(enrollments).where(eq(enrollments.id, id)).limit(1);
  return row;
}

describe('серия', () => {
  it('все обязательные сданы — день полный, серия растёт', async () => {
    const made = await given();
    await report(h.db, made.enrollmentId, MANDATORY);

    await h.workers.evaluateDay(made.enrollmentId, DAY);

    const e = await enrollmentById(made.enrollmentId);
    expect(e.streak).toBe(1);
    expect(e.bestStreak).toBe(1);
  });

  it('одна обязательная не сдана — серия обнуляется, но лучшая остаётся', async () => {
    const made = await given({ streak: 4 });
    // Куптан не сдан.
    await report(h.db, made.enrollmentId, ['t2', 't3', 't4', 't5']);

    await h.workers.evaluateDay(made.enrollmentId, DAY);

    const e = await enrollmentById(made.enrollmentId);
    expect(e.streak).toBe(0);
    expect(e.bestStreak).toBe(4);
  });

  it('уважительный день полный без отчётов', async () => {
    const made = await given({ streak: 2 });
    await h.db.insert(excusedDays).values({ enrollmentId: made.enrollmentId, dayKey: DAY });

    await h.workers.evaluateDay(made.enrollmentId, DAY);

    expect((await enrollmentById(made.enrollmentId)).streak).toBe(3);
  });

  it('день на паузе полный без отчётов', async () => {
    const made = await given({ status: 'paused', streak: 2 });

    await h.workers.evaluateDay(made.enrollmentId, DAY);

    expect((await enrollmentById(made.enrollmentId)).streak).toBe(3);
  });

  it('в день регистрации не требуются окна, открывшиеся до входа', async () => {
    // Вошла в 09:40 по Бишкеку: Багымдат (06:18) уже прошёл и не обязателен.
    const made = await given({ joinedAt: new Date('2026-11-08T03:40:00Z') });
    await report(h.db, made.enrollmentId, ['t3', 't4', 't5', 't6']);

    await h.workers.evaluateDay(made.enrollmentId, DAY);

    expect((await enrollmentById(made.enrollmentId)).streak).toBe(1);
  });

  it('тот же день повторно не оценивается', async () => {
    const made = await given();
    await report(h.db, made.enrollmentId, MANDATORY);

    await h.workers.evaluateDay(made.enrollmentId, DAY);
    await h.workers.evaluateDay(made.enrollmentId, DAY);

    expect((await enrollmentById(made.enrollmentId)).streak).toBe(1);
  });
});

describe('бонус за серию', () => {
  it('седьмой день подряд даёт баллы, запись в журнале и сообщение', async () => {
    const made = await given({ streak: 6, points: 60 });
    await report(h.db, made.enrollmentId, MANDATORY);

    await h.workers.evaluateDay(made.enrollmentId, DAY);

    const e = await enrollmentById(made.enrollmentId);
    expect(e.streak).toBe(7);
    // В сиде m5 бонус — 5 баллов каждые 7 дней.
    expect(e.points).toBe(65);

    const ledger = await h.db.select().from(pointsLedger).where(eq(pointsLedger.enrollmentId, made.enrollmentId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(5);
    expect(ledger[0].reason).toContain('7');

    const text = h.texts().join('\n');
    expect(text).toContain('7');
    expect(text).toContain('5');
  });

  it('на не кратной семи серии бонуса нет', async () => {
    const made = await given({ streak: 4, points: 40 });
    await report(h.db, made.enrollmentId, MANDATORY);

    await h.workers.evaluateDay(made.enrollmentId, DAY);

    const e = await enrollmentById(made.enrollmentId);
    expect(e.streak).toBe(5);
    expect(e.points).toBe(40);
    expect(await h.db.select().from(pointsLedger).where(eq(pointsLedger.enrollmentId, made.enrollmentId))).toHaveLength(0);
  });
});
