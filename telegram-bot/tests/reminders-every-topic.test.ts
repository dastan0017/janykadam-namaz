import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { marathons, participants, remindersLog, topics } from '../src/db/schema';
import { decideReminder } from '../src/domain/reminders';
import {
  BISHKEK, makeHarness, makeParticipant, marathonIdByCode, wipeParticipants, type Harness,
} from './helpers/bot-harness';

/**
 * Напоминание при открытии каждой темы.
 *
 * Раньше до участницы доходило не больше шести напоминаний в день: лимит из
 * сида при одиннадцати темах молча срезал половину, а утреннее сообщение и
 * отметка об оценке дня ещё и съедали его. Тема, открывшаяся в тихие часы,
 * не получала напоминания вовсе.
 */

const TG_PREFIX = '9120';
/** 2026-11-08, 00:30 по Бишкеку: весь день ещё впереди. */
const MIDNIGHT_BISHKEK = new Date('2026-11-07T18:30:00Z');
const DAY = '2026-11-08';

let h: Harness;
const added: string[] = [];

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  vi.useRealTimers();
  await h.close();
});

afterEach(async () => {
  vi.useRealTimers();
  for (const id of added.splice(0)) await h.db.delete(topics).where(eq(topics.id, id));
  await wipeParticipants(h.db, TG_PREFIX);
  h.reset();
});

const local = (d: Date) => DateTime.fromJSDate(d, { zone: BISHKEK.tz }).toFormat('HH:mm');

/** Временная своя тема в демо-марафоне — с окном, которое нужно тесту. */
async function addTopic(nameKg: string, start: string, end: string): Promise<string> {
  const marathonId = await marathonIdByCode(h.db, 'm5');
  const [t] = await h.db
    .insert(topics)
    .values({ marathonId, nameKg, nameRu: nameKg, startLocal: start, endLocal: end, position: 99 })
    .returning();
  added.push(t.id);
  return t.id;
}

async function planToday(tgUserId: string) {
  const made = await makeParticipant(h.db, { tgUserId, place: BISHKEK });
  const [p] = await h.db.select().from(participants).where(eq(participants.id, made.participantId)).limit(1);
  const [m] = await h.db.select().from(marathons).where(eq(marathons.id, await marathonIdByCode(h.db, 'm5'))).limit(1);
  h.reset();
  await h.planner.planDay(made.enrollmentId, p, m, DAY);
  return { made, jobs: h.jobs.slice() };
}

describe('лимит напоминаний', () => {
  const base = {
    enrollmentActive: true, paused: false, blocked: false, topicEnabled: true,
    alreadyReported: false, windowClosed: false, quiet: false, optIn: false, optedIn: false,
  };

  it('0 — без лимита: двенадцатая тема тоже получает напоминание', () => {
    expect(decideReminder({ ...base, sentToday: 11, capPerDay: 0 }).send).toBe(true);
  });

  it('заданный лимит по-прежнему работает', () => {
    expect(decideReminder({ ...base, sentToday: 3, capPerDay: 3 })).toEqual({ send: false, reason: 'cap' });
  });

  it('утреннее сообщение и оценка дня в лимит не входят', async () => {
    const made = await makeParticipant(h.db, { tgUserId: `${TG_PREFIX}01`, place: BISHKEK });
    await h.notify.markSent(made.enrollmentId, 'morning', null, DAY);
    await h.notify.markSent(made.enrollmentId, 'eval', null, DAY);
    await h.notify.markSent(made.enrollmentId, 'topic', 't2', DAY);

    expect(await h.notify.sentToday(made.enrollmentId, DAY)).toBe(1);
    await h.db.delete(remindersLog).where(eq(remindersLog.enrollmentId, made.enrollmentId));
  });
});

describe('напоминание о каждой теме', () => {
  it('каждая включённая тема дня получает задание на напоминание', async () => {
    vi.useFakeTimers({ now: MIDNIGHT_BISHKEK, toFake: ['Date'] });
    const { made, jobs } = await planToday(`${TG_PREFIX}02`);

    const reminders = jobs.filter((j) => j.opts.singletonKey?.startsWith(`rem:${made.enrollmentId}:`));
    // Все дневные темы демо-марафона, кроме Тахажуда — он только по согласию.
    expect(reminders.length).toBeGreaterThanOrEqual(8);
    expect(reminders.some((j) => j.opts.singletonKey!.includes(':t1:'))).toBe(false);
  });

  it('тема, открывшаяся в тихие часы, получает напоминание сразу после них', async () => {
    vi.useFakeTimers({ now: MIDNIGHT_BISHKEK, toFake: ['Date'] });
    const id = await addTopic('Таңкы зикир', '03:00', '06:00');
    const { made, jobs } = await planToday(`${TG_PREFIX}03`);

    const job = jobs.find((j) => j.opts.singletonKey === `rem:${made.enrollmentId}:${id}:${DAY}`);
    expect(job, 'напоминание поставлено').toBeTruthy();
    // Тихие часы 22:30–04:30: окно открылось в 03:00, напоминание — в 04:30.
    expect(local(job!.opts.startAfter!)).toBe('04:30');
  });

  it('тема целиком в тихих часах напоминания не получает — ночью не будим', async () => {
    vi.useFakeTimers({ now: MIDNIGHT_BISHKEK, toFake: ['Date'] });
    const id = await addTopic('Түнкү тема', '01:00', '02:00');
    const { made, jobs } = await planToday(`${TG_PREFIX}04`);

    expect(jobs.some((j) => j.opts.singletonKey === `rem:${made.enrollmentId}:${id}:${DAY}`)).toBe(false);
  });
});
