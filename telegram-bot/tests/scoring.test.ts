import { describe, expect, it } from 'vitest';
import { advanceStreak, canSubmitLate, isDayComplete, latePassesLeft, reportPoints } from '../src/domain/scoring';
import type { WindowInstance } from '../src/domain/windows';

function win(topicId: string, opensAt: string, mandatory = true): WindowInstance {
  return {
    topicKind: 'namaz',
    topicId,
    dayKey: '2026-11-08',
    opensAt: new Date(opensAt),
    closesAt: new Date(new Date(opensAt).getTime() + 3_600_000),
    mandatory,
    points: 10,
    emoji: '🌅',
    nameKg: topicId,
    nameRu: topicId,
    optIn: false,
    remindOffsetMin: 0,
  };
}

const EARLY = new Date('2026-11-08T00:00:00Z');

describe('баллы за отчёт', () => {
  it('тема плюс варианты', () => {
    expect(reportPoints(10, [])).toBe(10);
    expect(reportPoints(0, [3])).toBe(3);
    expect(reportPoints(5, [3, 4])).toBe(12);
  });
});

describe('полный день', () => {
  const mandatory = [win('t2', '2026-11-08T01:00:00Z'), win('t3', '2026-11-08T07:00:00Z')];

  it('все обязательные сданы — день полный', () => {
    expect(isDayComplete({ mandatory, reportedTopicIds: new Set(['t2', 't3']), excused: false, paused: false, joinedAt: EARLY })).toBe(true);
  });

  it('одна обязательная не сдана — день неполный', () => {
    expect(isDayComplete({ mandatory, reportedTopicIds: new Set(['t2']), excused: false, paused: false, joinedAt: EARLY })).toBe(false);
  });

  it('уважительный день считается полным', () => {
    expect(isDayComplete({ mandatory, reportedTopicIds: new Set(), excused: true, paused: false, joinedAt: EARLY })).toBe(true);
  });

  it('день на паузе считается полным', () => {
    expect(isDayComplete({ mandatory, reportedTopicIds: new Set(), excused: false, paused: true, joinedAt: EARLY })).toBe(true);
  });

  it('в день регистрации обязательны только окна, открывшиеся после входа', () => {
    // Зарегистрировалась в 05:00 UTC: Багымдат в 01:00 уже прошёл и не требуется.
    const joinedAt = new Date('2026-11-08T05:00:00Z');
    expect(isDayComplete({ mandatory, reportedTopicIds: new Set(['t3']), excused: false, paused: false, joinedAt })).toBe(true);
    // А Пешим в 07:00 открылся после входа и требуется.
    expect(isDayComplete({ mandatory, reportedTopicIds: new Set(), excused: false, paused: false, joinedAt })).toBe(false);
  });

  it('если после входа не открылось ни одного обязательного окна, день полный', () => {
    const joinedAt = new Date('2026-11-08T23:00:00Z');
    expect(isDayComplete({ mandatory, reportedTopicIds: new Set(), excused: false, paused: false, joinedAt })).toBe(true);
  });

  it('необязательные темы на полноту дня не влияют', () => {
    const withOptional = [...mandatory, win('t1', '2026-11-08T00:30:00Z', false)];
    const onlyMandatory = withOptional.filter((w) => w.mandatory);
    expect(
      isDayComplete({ mandatory: onlyMandatory, reportedTopicIds: new Set(['t2', 't3']), excused: false, paused: false, joinedAt: EARLY }),
    ).toBe(true);
  });
});

describe('серия', () => {
  const rules = { streakEvery: 7, streakBonus: 5 };

  it('полный день удлиняет серию', () => {
    expect(advanceStreak({ streak: 2, bestStreak: 5 }, true, rules)).toMatchObject({ streak: 3, bestStreak: 5, bonusAwarded: false });
  });

  it('неполный день обнуляет серию, но не лучший результат', () => {
    expect(advanceStreak({ streak: 6, bestStreak: 9 }, false, rules)).toMatchObject({ streak: 0, bestStreak: 9, bonusAwarded: false });
  });

  it('новый рекорд обновляется', () => {
    expect(advanceStreak({ streak: 9, bestStreak: 9 }, true, rules).bestStreak).toBe(10);
  });

  it('бонус на каждый седьмой день', () => {
    expect(advanceStreak({ streak: 6, bestStreak: 6 }, true, rules)).toMatchObject({ streak: 7, bonusAwarded: true, bonusPoints: 5 });
    expect(advanceStreak({ streak: 13, bestStreak: 13 }, true, rules)).toMatchObject({ streak: 14, bonusAwarded: true, bonusPoints: 5 });
  });

  it('между кратными бонуса нет', () => {
    expect(advanceStreak({ streak: 7, bestStreak: 7 }, true, rules).bonusAwarded).toBe(false);
  });

  it('нулевой бонус не начисляется', () => {
    expect(advanceStreak({ streak: 6, bestStreak: 6 }, true, { streakEvery: 7, streakBonus: 0 }).bonusAwarded).toBe(false);
  });
});

describe('поздние сдачи', () => {
  it('остаток считается и не уходит в минус', () => {
    expect(latePassesLeft(2, 0)).toBe(2);
    expect(latePassesLeft(2, 2)).toBe(0);
    expect(latePassesLeft(2, 5)).toBe(0);
  });

  it('сдавать поздно можно, пока есть остаток', () => {
    expect(canSubmitLate(2, 0)).toBe(true);
    expect(canSubmitLate(2, 1)).toBe(true);
    expect(canSubmitLate(2, 2)).toBe(false);
  });
});
