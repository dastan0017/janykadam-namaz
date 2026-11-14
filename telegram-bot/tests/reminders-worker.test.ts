import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { botSettings, enrollments, participants, remindersLog } from '../src/db/schema';
import type { TopicReminderJob } from '../src/jobs/planner.service';
import {
  BISHKEK, insertReport, makeHarness, makeParticipant, remindersCount,
  wipeParticipants, type Harness, type MadeParticipant,
} from './helpers/bot-harness';

/**
 * Пункт 14.8 чек-листа: воркер напоминаний.
 *
 * Все проверки делаются в момент срабатывания задания, а не при планировании:
 * за это время участница могла сдать, уйти на паузу, заблокировать бота, а тему
 * могли выключить. Журнал `reminders_log` служит сразу двум целям — он же
 * защита от повтора после перезапуска, он же счётчик дневного лимита.
 *
 * Бишкек, 8 ноября 2026: Пешим 12:45–16:03, Куптан 19:06 — до фаджра 06:20
 * девятого, Тахажуд девятого открывается в 03:50.
 */

const TG_PREFIX = '9120';

/** Пешим: окно целиком внутри дня, напоминание в 13:00 по местному времени. */
const PESHIM = {
  topicKind: 'namaz' as const,
  topicId: 't3',
  dayKey: '2026-11-08',
  opensAt: '2026-11-08T06:45:00.000Z',
  closesAt: '2026-11-08T10:03:00.000Z',
};
const AT_1300 = new Date('2026-11-08T07:00:00Z');

/** Куптан: окно пересекает полночь и заходит в тихие часы. */
const KUPTAN = {
  topicKind: 'namaz' as const,
  topicId: 't6',
  dayKey: '2026-11-08',
  opensAt: '2026-11-08T13:06:00.000Z',
  closesAt: '2026-11-09T00:20:00.000Z',
};
const AT_2300 = new Date('2026-11-08T17:00:00Z');

/** Тахажуд: окно целиком в тихих часах, поэтому требует согласия. */
const TAHAJJUD = {
  topicKind: 'namaz' as const,
  topicId: 't1',
  dayKey: '2026-11-09',
  opensAt: '2026-11-08T21:50:00.000Z',
  closesAt: '2026-11-09T00:20:00.000Z',
};
const AT_0400 = new Date('2026-11-08T22:00:00Z');

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

/** Участница в Бишкеке и момент, в который срабатывает задание. */
async function given(
  at: Date,
  opts: { status?: 'active' | 'paused'; blocked?: boolean; tahajjud?: boolean } = {},
): Promise<MadeParticipant> {
  vi.useFakeTimers({ now: at, toFake: ['Date'] });
  const made = await makeParticipant(h.db, {
    tgUserId: `${TG_PREFIX}${String(++seq).padStart(2, '0')}`,
    place: BISHKEK,
    ...opts,
  });
  h.reset();
  return made;
}

const job = (made: MadeParticipant, base: Omit<TopicReminderJob, 'enrollmentId'>): TopicReminderJob => ({
  enrollmentId: made.enrollmentId,
  ...base,
});

describe('напоминание уходит', () => {
  it('с эмодзи, названием темы и временем закрытия по её часам', async () => {
    const made = await given(AT_1300);
    await h.workers.sendTopicReminder(job(made, PESHIM));

    expect(h.texts()).toHaveLength(1);
    expect(h.texts()[0]).toContain('Пешим');
    // 16:03 по Бишкеку — то же, что 10:03 UTC в задании.
    expect(h.texts()[0]).toContain('16:03');

    expect(await remindersCount(h.db, made.enrollmentId, '2026-11-08')).toBe(1);
  });

  it('повторный запуск задания после перезапуска не шлёт второго сообщения', async () => {
    const made = await given(AT_1300);

    await h.workers.sendTopicReminder(job(made, PESHIM));
    await h.workers.sendTopicReminder(job(made, PESHIM));

    expect(h.texts()).toHaveLength(1);
    expect(await remindersCount(h.db, made.enrollmentId, '2026-11-08')).toBe(1);
  });

  it('Тахажуд уходит в тихие часы, если участница согласилась', async () => {
    const made = await given(AT_0400, { tahajjud: true });
    await h.workers.sendTopicReminder(job(made, TAHAJJUD));

    expect(h.texts()).toHaveLength(1);
    expect(h.texts()[0]).toContain('Тахажуд');
  });
});

describe('напоминание не уходит', () => {
  it('тема уже сдана', async () => {
    const made = await given(AT_1300);
    await insertReport(h.db, { enrollmentId: made.enrollmentId, topicId: 't3', dayKey: '2026-11-08' });

    await h.workers.sendTopicReminder(job(made, PESHIM));
    expect(h.texts()).toHaveLength(0);
    expect(await remindersCount(h.db, made.enrollmentId, '2026-11-08')).toBe(0);
  });

  it('участница на паузе', async () => {
    const made = await given(AT_1300, { status: 'paused' });
    await h.workers.sendTopicReminder(job(made, PESHIM));
    expect(h.texts()).toHaveLength(0);
  });

  it('участница заблокировала бота', async () => {
    const made = await given(AT_1300, { blocked: true });
    await h.workers.sendTopicReminder(job(made, PESHIM));
    expect(h.texts()).toHaveLength(0);
  });

  it('окно успело закрыться, пока задание ждало очереди', async () => {
    // 16:30 по Бишкеку: Пешим закрылся в 16:03.
    const made = await given(new Date('2026-11-08T10:30:00Z'));
    await h.workers.sendTopicReminder(job(made, PESHIM));
    expect(h.texts()).toHaveLength(0);
  });

  it('тихие часы: Куптан открыт, но в 23:00 бот молчит', async () => {
    const made = await given(AT_2300);
    await h.workers.sendTopicReminder(job(made, KUPTAN));
    expect(h.texts()).toHaveLength(0);
  });

  it('Тахажуд без согласия — даже когда окно открыто', async () => {
    const made = await given(AT_0400, { tahajjud: false });
    await h.workers.sendTopicReminder(job(made, TAHAJJUD));
    expect(h.texts()).toHaveLength(0);
  });

  it('дневной лимит исчерпан', async () => {
    const made = await given(AT_1300);

    // По умолчанию лимита нет; здесь его ставит админ — шесть в день.
    await h.db.update(botSettings).set({ capPerDay: 6 }).where(eq(botSettings.id, 1));
    h.settings.invalidate();

    // Шесть напоминаний о темах за этот день уже ушло — это и есть предел.
    await h.db.insert(remindersLog).values(
      [1, 2, 3, 4, 5, 6].map((n) => ({
        enrollmentId: made.enrollmentId,
        kind: 'topic',
        topicId: `x${n}`,
        dayKey: '2026-11-08',
      })),
    );

    try {
      await h.workers.sendTopicReminder(job(made, PESHIM));
      expect(h.texts()).toHaveLength(0);
    } finally {
      await h.db.update(botSettings).set({ capPerDay: 0 }).where(eq(botSettings.id, 1));
      h.settings.invalidate();
    }
  });

  it('тему убрали из марафона, пока задание ждало', async () => {
    const made = await given(AT_1300);
    await h.workers.sendTopicReminder(
      job(made, { ...PESHIM, topicKind: 'custom', topicId: randomUUID() }),
    );
    expect(h.texts()).toHaveLength(0);
  });

  it('запись исчезла — задание молча заканчивается', async () => {
    const made = await given(AT_1300);
    await h.db.delete(enrollments).where(eq(enrollments.id, made.enrollmentId));
    await h.db
      .update(participants)
      .set({ activeEnrollmentId: null })
      .where(eq(participants.id, made.participantId));

    await expect(h.workers.sendTopicReminder(job(made, PESHIM))).resolves.toBeUndefined();
    expect(h.texts()).toHaveLength(0);
  });
});
