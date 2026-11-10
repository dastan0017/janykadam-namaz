import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { enrollments, excusedDays, participants } from '../src/db/schema';
import { decideReminder } from '../src/domain/reminders';
import { isDayComplete } from '../src/domain/scoring';
import { shortName } from '../src/domain/text';
import type { WindowInstance } from '../src/domain/windows';
import {
  callbackUpdate, lastButtons, makeHarness, TEST_TG_USER_ID, textUpdate, wipeTestParticipant, type Harness,
} from './helpers/bot-harness';

/**
 * Узур: день, когда намазы не требуются, а остальные темы марафона — да.
 * Проверяем и чистую логику, и сквозной путь через бота.
 */

const AT_0940_BISHKEK = new Date('2026-11-08T03:40:00Z');
/** 13:00 по Бишкеку: Пешим открыт — на нём и видно, что узур убирает намазы. */
const AT_1300_BISHKEK = new Date('2026-11-08T07:00:00Z');
const EARLY = new Date('2026-11-08T00:00:00Z');

function win(topicId: string, kind: 'namaz' | 'custom'): WindowInstance {
  return {
    topicKind: kind,
    topicId,
    dayKey: '2026-11-08',
    opensAt: new Date('2026-11-08T02:00:00Z'),
    closesAt: new Date('2026-11-08T14:00:00Z'),
    mandatory: true,
    points: 10,
    emoji: '🕌',
    nameKg: topicId,
    nameRu: topicId,
    optIn: false,
    remindOffsetMin: 0,
  };
}

describe('узур в подсчёте дня', () => {
  const mandatory = [win('t2', 'namaz'), win('t3', 'namaz'), win('custom-1', 'custom')];

  it('намазы не требуются, своя тема — требуется', () => {
    expect(
      isDayComplete({ mandatory, reportedTopicIds: new Set(['custom-1']), excused: false, paused: false, namazExcused: true, joinedAt: EARLY }),
    ).toBe(true);

    expect(
      isDayComplete({ mandatory, reportedTopicIds: new Set(['t2', 't3']), excused: false, paused: false, namazExcused: true, joinedAt: EARLY }),
    ).toBe(false);
  });

  it('без узура намазы по-прежнему обязательны', () => {
    expect(
      isDayComplete({ mandatory, reportedTopicIds: new Set(['custom-1']), excused: false, paused: false, joinedAt: EARLY }),
    ).toBe(false);
  });

  it('уважительный день куратора снимает всё', () => {
    expect(
      isDayComplete({ mandatory, reportedTopicIds: new Set(), excused: true, paused: false, joinedAt: EARLY }),
    ).toBe(true);
  });
});

describe('узур в напоминаниях', () => {
  const base = {
    enrollmentActive: true, paused: false, blocked: false, topicEnabled: true,
    alreadyReported: false, windowClosed: false, quiet: false, sentToday: 0,
    capPerDay: 6, optIn: false, optedIn: false,
  };

  it('о намазе в узур не напоминаем', () => {
    expect(decideReminder({ ...base, uzurNamaz: true })).toEqual({ send: false, reason: 'uzur' });
  });

  it('свою тему марафона в тот же день напоминаем', () => {
    expect(decideReminder({ ...base, uzurNamaz: false }).send).toBe(true);
  });
});

describe('имя в рейтинге', () => {
  it('фамилия сокращается до буквы', () => {
    expect(shortName('Нургүл', 'Сатыбалдиева')).toBe('Нургүл С.');
  });

  it('без фамилии остаётся одно имя', () => {
    expect(shortName('Дастан', '')).toBe('Дастан');
    expect(shortName('Дастан')).toBe('Дастан');
  });
});

describe('узур и цель через бота', () => {
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

  async function register(): Promise<void> {
    await h.feed(textUpdate('/start m5', AT_0940_BISHKEK));
    await h.feed(callbackUpdate('lang:kg'));
    await h.feed(textUpdate('Бишкек · UTC+6', AT_0940_BISHKEK));
    await h.feed(callbackUpdate('rules:yes'));
    // Вопрос о цели приходит до приветствия — отвечаем на него.
    await h.feed(textUpdate('Намазды калтырбоо', AT_0940_BISHKEK));
  }

  it('«Өзүм жөнүндө» показывает рейтинг, цель и кнопку узура', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await register();
    h.reset();

    await h.feed(textUpdate('😎 Өзүм жөнүндө', AT_0940_BISHKEK));
    const text = h.lastText();
    expect(text).toMatch(/Рейтинг/);
    expect(text).toContain('Намазды калтырбоо');

    const buttons = lastButtons(h).map((b) => b.callback_data);
    expect(buttons).toContain('uzur:on');
    expect(buttons).toContain('goal:write');
  });

  it('узур убирает намазы из списка и пишется в базу', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await register();

    // 13:00 по Бишкеку: Пешим открыт, и до узура он в списке есть.
    vi.setSystemTime(AT_1300_BISHKEK);
    h.reset();
    await h.feed(textUpdate('🎥 Отчёт тапшыруу', AT_1300_BISHKEK));
    expect(h.lastText(), 'до узура намаз в списке').toContain('Пешим');

    await h.feed(callbackUpdate('uzur:on'));
    expect(h.lastText()).toMatch(/узур|Узур/);

    const [p] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID));
    const [e] = await h.db.select().from(enrollments).where(eq(enrollments.participantId, p.id));
    const rows = await h.db
      .select()
      .from(excusedDays)
      .where(and(eq(excusedDays.enrollmentId, e.id), eq(excusedDays.dayKey, '2026-11-08')));

    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe('namaz');
    expect(rows[0].markedBy).toBeNull();

    // «Отчёт тапшыруу» больше не предлагает намазы этого дня.
    h.reset();
    await h.feed(textUpdate('🎥 Отчёт тапшыруу', AT_1300_BISHKEK));
    expect(h.lastText()).not.toMatch(/Багымдат|Пешим|Аср|Шам|Куптан/);

    // Повторное нажатие снимает отметку.
    await h.feed(callbackUpdate('uzur:off'));
    const after = await h.db.select().from(excusedDays).where(eq(excusedDays.enrollmentId, e.id));
    expect(after).toHaveLength(0);
  });
});
