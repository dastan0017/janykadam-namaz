import type { WindowInstance } from './windows';

/**
 * Баллы, полные дни и серии. Чистые функции: ни Telegram, ни БД.
 */

/** Баллы за отчёт: баллы темы плюс баллы выбранных вариантов ответа. */
export function reportPoints(topicPoints: number, optionPoints: number[]): number {
  return topicPoints + optionPoints.reduce((a, b) => a + b, 0);
}

export interface DayCompletionInput {
  /** Обязательные окна этого ключа дня. */
  mandatory: WindowInstance[];
  /** Темы, по которым отчёт за этот день есть (поздние тоже считаются). */
  reportedTopicIds: ReadonlySet<string>;
  /** День отмечен куратором как уважительный. */
  excused: boolean;
  /** В этот день участница была на паузе. */
  paused: boolean;
  /** Момент регистрации: в день входа обязательны только окна, открывшиеся после него. */
  joinedAt: Date;
}

/**
 * День полный, если сданы все обязательные темы этого дня, либо день
 * уважительный, либо участница была на паузе.
 *
 * В день регистрации обязательны только те окна, которые открылись уже после
 * того, как она вошла: нельзя требовать Багымдат у той, кто зарегистрировалась днём.
 */
export function isDayComplete(input: DayCompletionInput): boolean {
  if (input.excused || input.paused) return true;

  const required = input.mandatory.filter((w) => w.opensAt.getTime() >= input.joinedAt.getTime());
  if (required.length === 0) return true;

  return required.every((w) => input.reportedTopicIds.has(w.topicId));
}

export interface StreakState {
  streak: number;
  bestStreak: number;
}

export interface StreakUpdate extends StreakState {
  /** Начислен ли бонус за серию на этом шаге. */
  bonusAwarded: boolean;
  bonusPoints: number;
}

/**
 * Переход серии после оценки одного дня.
 * Бонус даётся, когда серия становится кратной `streakEvery`.
 */
export function advanceStreak(
  state: StreakState,
  dayComplete: boolean,
  rules: { streakEvery: number; streakBonus: number },
): StreakUpdate {
  if (!dayComplete) {
    return { streak: 0, bestStreak: state.bestStreak, bonusAwarded: false, bonusPoints: 0 };
  }

  const streak = state.streak + 1;
  const bestStreak = Math.max(state.bestStreak, streak);
  const hitsMultiple = rules.streakEvery > 0 && streak % rules.streakEvery === 0;

  return {
    streak,
    bestStreak,
    bonusAwarded: hitsMultiple && rules.streakBonus > 0,
    bonusPoints: hitsMultiple ? rules.streakBonus : 0,
  };
}

/** Остаток поздних сдач. */
export function latePassesLeft(allowed: number, used: number): number {
  return Math.max(0, allowed - used);
}

export function canSubmitLate(allowed: number, used: number): boolean {
  return latePassesLeft(allowed, used) > 0;
}
