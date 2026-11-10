import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { marathons, participants, topics } from '../src/db/schema';
import {
  BISHKEK, makeHarness, makeParticipant, marathonIdByCode, NEW_YORK, wipeParticipants,
  type Harness, type SentJob,
} from './helpers/bot-harness';

/**
 * Пункт 14.9 чек-листа: переход на зимнее время.
 *
 * В США зимнее время наступает 1 ноября 2026. Проверено расчётом: в Нью-Йорке
 * фаджр 31 октября — 06:03 местного / 10:03 UTC, 1 ноября — 05:04 местного /
 * 10:04 UTC.
 *
 * Отсюда два разных поведения, которые спецификация смешивала в одно:
 *   • у тем-намазов момент в UTC почти не меняется, а местное время прыгает на
 *     час — фаджр солнечное событие, а не время на часах;
 *   • у своих тем с фиксированным местным окном наоборот: местное время то же,
 *     а момент в UTC сдвигается на час.
 */

const TG_PREFIX = '9110';
/** Момент планирования: всё, что планируется, ещё в будущем. */
const BEFORE = new Date('2026-10-30T12:00:00Z');

let h: Harness;

const localOf = (d: Date) => DateTime.fromJSDate(d, { zone: NEW_YORK.tz }).toFormat('yyyy-MM-dd HH:mm');
const utcOf = (d: Date) => DateTime.fromJSDate(d, { zone: 'utc' }).toFormat('yyyy-MM-dd HH:mm');

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

/** Планирует указанные дни и возвращает поставленные задания. */
async function planDays(tgUserId: string, days: string[], opts: { tahajjud?: boolean } = {}) {
  const made = await makeParticipant(h.db, { tgUserId, place: NEW_YORK, tahajjud: opts.tahajjud });

  const [p] = await h.db.select().from(participants).where(eq(participants.id, made.participantId)).limit(1);
  const marathonId = await marathonIdByCode(h.db, 'm5');
  const [m] = await h.db.select().from(marathons).where(eq(marathons.id, marathonId)).limit(1);

  h.reset();
  for (const day of days) await h.planner.planDay(made.enrollmentId, p, m, day);
  return { made, jobs: h.jobs.slice() };
}

/** Задание по детерминированному ключу — по нему же pg-boss отсеивает повторы. */
function byKey(jobs: SentJob[], key: string): SentJob {
  const job = jobs.find((j) => j.opts.singletonKey === key);
  expect(job, `задание с ключом ${key}`).toBeTruthy();
  return job!;
}

describe('планирование при переходе на зимнее время', () => {
  it('у намаза держится момент в UTC, а местное время сдвигается', async () => {
    vi.useFakeTimers({ now: BEFORE, toFake: ['Date'] });
    const { made, jobs } = await planDays(`${TG_PREFIX}01`, ['2026-10-31', '2026-11-01']);
    const eid = made.enrollmentId;

    const before = byKey(jobs, `rem:${eid}:t2:2026-10-31`).opts.startAfter!;
    const after = byKey(jobs, `rem:${eid}:t2:2026-11-01`).opts.startAfter!;

    expect(utcOf(before)).toBe('2026-10-31 10:03');
    expect(localOf(before)).toBe('2026-10-31 06:03');

    expect(utcOf(after)).toBe('2026-11-01 10:04');
    // Час назад по местным часам — при почти том же моменте в UTC.
    expect(localOf(after)).toBe('2026-11-01 05:04');
  });

  it('у своей темы держится местное время, а момент в UTC сдвигается', async () => {
    vi.useFakeTimers({ now: BEFORE, toFake: ['Date'] });

    const marathonId = await marathonIdByCode(h.db, 'm5');
    const [zikr] = await h.db
      .select()
      .from(topics)
      .where(and(eq(topics.marathonId, marathonId), eq(topics.nameKg, 'Зикир')))
      .limit(1);
    expect(zikr?.startLocal.slice(0, 5)).toBe('05:00');

    const { made, jobs } = await planDays(`${TG_PREFIX}02`, ['2026-10-31', '2026-11-01']);
    const eid = made.enrollmentId;

    const before = byKey(jobs, `rem:${eid}:${zikr.id}:2026-10-31`).opts.startAfter!;
    const after = byKey(jobs, `rem:${eid}:${zikr.id}:2026-11-01`).opts.startAfter!;

    expect(localOf(before)).toBe('2026-10-31 05:00');
    expect(localOf(after)).toBe('2026-11-01 05:00');

    expect(utcOf(before)).toBe('2026-10-31 09:00');
    expect(utcOf(after)).toBe('2026-11-01 10:00');
  });

  it('утреннее сообщение марафона ведёт себя как фиксированное местное время', async () => {
    vi.useFakeTimers({ now: BEFORE, toFake: ['Date'] });
    const { made, jobs } = await planDays(`${TG_PREFIX}03`, ['2026-10-31', '2026-11-01']);
    const eid = made.enrollmentId;

    // В сиде m5 утро в 05:30, вечер в 21:00 по местному времени участницы.
    const before = byKey(jobs, `morning:${eid}:2026-10-31`).opts.startAfter!;
    const after = byKey(jobs, `morning:${eid}:2026-11-01`).opts.startAfter!;

    expect(localOf(before)).toBe('2026-10-31 05:30');
    expect(localOf(after)).toBe('2026-11-01 05:30');
    expect(utcOf(before)).toBe('2026-10-31 09:30');
    expect(utcOf(after)).toBe('2026-11-01 10:30');
  });

  it('оценка дня ставится на следующий фаджр: Куптан закрывается уже назавтра', async () => {
    vi.useFakeTimers({ now: BEFORE, toFake: ['Date'] });
    const { made, jobs } = await planDays(`${TG_PREFIX}04`, ['2026-10-31']);

    const evaluate = byKey(jobs, `eval:${made.enrollmentId}:2026-10-31`).opts.startAfter!;
    expect(utcOf(evaluate)).toBe('2026-11-01 10:04');
  });
});

describe('планирование в остальном', () => {
  it('Тахажуд планируется только согласившимся', async () => {
    vi.useFakeTimers({ now: BEFORE, toFake: ['Date'] });

    const off = await planDays(`${TG_PREFIX}05`, ['2026-10-31']);
    expect(off.jobs.some((j) => String(j.opts.singletonKey).includes(':t1:'))).toBe(false);

    const on = await planDays(`${TG_PREFIX}06`, ['2026-10-31'], { tahajjud: true });
    const job = byKey(on.jobs, `rem:${on.made.enrollmentId}:t1:2026-10-31`);
    // Окно Тахажуда — за 2,5 часа до фаджра, то есть ночью.
    expect(localOf(job.opts.startAfter!)).toBe('2026-10-31 03:33');
  });

  it('повторное планирование даёт те же ключи — pg-boss отсеет дубли', async () => {
    vi.useFakeTimers({ now: BEFORE, toFake: ['Date'] });
    const { made, jobs } = await planDays(`${TG_PREFIX}07`, ['2026-10-31']);

    const [p] = await h.db.select().from(participants).where(eq(participants.id, made.participantId)).limit(1);
    const marathonId = await marathonIdByCode(h.db, 'm5');
    const [m] = await h.db.select().from(marathons).where(eq(marathons.id, marathonId)).limit(1);

    h.reset();
    await h.planner.planDay(made.enrollmentId, p, m, '2026-10-31');

    const keysOf = (list: SentJob[]) => list.map((j) => j.opts.singletonKey).sort();
    expect(keysOf(h.jobs)).toEqual(keysOf(jobs));
  });

  it('planAll берёт активные записи и обходит вышедших', async () => {
    // 2026-11-04, 23:10 UTC — в Бишкеке 05:10 пятого: местные сутки начались,
    // но утреннее сообщение (05:30) ещё впереди.
    const now = new Date('2026-11-04T23:10:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });

    const active = await makeParticipant(h.db, { tgUserId: `${TG_PREFIX}08`, place: BISHKEK });
    const left = await makeParticipant(h.db, { tgUserId: `${TG_PREFIX}09`, place: BISHKEK, status: 'left' });
    h.reset();

    await h.planner.planAll(now);

    const keys = h.jobs.map((j) => String(j.opts.singletonKey));
    expect(keys.some((k) => k === `morning:${active.enrollmentId}:2026-11-05`)).toBe(true);
    expect(keys.some((k) => k.includes(left.enrollmentId))).toBe(false);
  });
});
