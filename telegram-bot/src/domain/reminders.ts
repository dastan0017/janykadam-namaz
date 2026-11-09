import { DateTime } from 'luxon';
import { parseHHMM } from './windows';

/**
 * Тихие часы и дневной лимит напоминаний.
 *
 * Общие для всех марафонов: чат у участницы один, и сколько бы марафонов она ни
 * вела, ночью сообщения приходить не должны.
 */

/** Тихие часы пересекают полночь (по умолчанию 22:30–04:30). */
export function isQuietAt(instant: Date, tz: string, quietFrom: string, quietTo: string): boolean {
  const local = DateTime.fromJSDate(instant, { zone: tz });
  const minutes = local.hour * 60 + local.minute;
  const from = parseHHMM(quietFrom.slice(0, 5));
  const to = parseHHMM(quietTo.slice(0, 5));

  // Окно внутри суток.
  if (from < to) return minutes >= from && minutes < to;
  // Окно через полночь: ночь принадлежит обоим календарным дням.
  return minutes >= from || minutes < to;
}

/**
 * Сдвигает момент к концу тихих часов. Используется для рассылок: напоминания
 * по темам в тихие часы просто не уходят, а рассылку переносим.
 */
export function shiftOutOfQuiet(instant: Date, tz: string, quietFrom: string, quietTo: string): Date {
  if (!isQuietAt(instant, tz, quietFrom, quietTo)) return instant;

  const local = DateTime.fromJSDate(instant, { zone: tz });
  const to = parseHHMM(quietTo.slice(0, 5));
  const minutes = local.hour * 60 + local.minute;

  // Если мы после полуночи и до конца тихих часов — конец сегодня, иначе завтра.
  const endToday = local.startOf('day').plus({ minutes: to });
  const target = minutes < to ? endToday : endToday.plus({ days: 1 });
  return target.toUTC().toJSDate();
}

/** Момент отправки напоминания по теме: открытие окна плюс смещение. */
export function reminderInstant(opensAt: Date, closesAt: Date, offsetMin: number): Date {
  // Отрицательное смещение отсчитывается от закрытия («за 30 мин до»).
  const base = offsetMin < 0 ? closesAt.getTime() + offsetMin * 60_000 : opensAt.getTime() + offsetMin * 60_000;
  return new Date(base);
}

export interface ReminderDecision {
  send: boolean;
  reason?: 'not_active' | 'paused' | 'blocked' | 'topic_off' | 'already_reported' | 'quiet' | 'cap' | 'opt_in' | 'window_closed';
}

export interface ReminderCheck {
  enrollmentActive: boolean;
  paused: boolean;
  blocked: boolean;
  topicEnabled: boolean;
  alreadyReported: boolean;
  windowClosed: boolean;
  quiet: boolean;
  /** Сколько напоминаний уже ушло сегодня. */
  sentToday: number;
  capPerDay: number;
  /** Тема требует согласия (Тахажуд). */
  optIn: boolean;
  optedIn: boolean;
}

/**
 * Все проверки перед отправкой выполняются в момент срабатывания задания,
 * а не при планировании: за это время участница могла сдать, уйти на паузу
 * или тему могли выключить.
 */
export function decideReminder(c: ReminderCheck): ReminderDecision {
  if (!c.enrollmentActive) return { send: false, reason: 'not_active' };
  if (c.paused) return { send: false, reason: 'paused' };
  if (c.blocked) return { send: false, reason: 'blocked' };
  if (!c.topicEnabled) return { send: false, reason: 'topic_off' };
  if (c.alreadyReported) return { send: false, reason: 'already_reported' };
  if (c.windowClosed) return { send: false, reason: 'window_closed' };

  // Тахажуд открывается ночью: он обходит тихие часы, но только для согласившихся.
  if (c.optIn) {
    if (!c.optedIn) return { send: false, reason: 'opt_in' };
    return { send: true };
  }

  if (c.quiet) return { send: false, reason: 'quiet' };
  if (c.sentToday >= c.capPerDay) return { send: false, reason: 'cap' };
  return { send: true };
}
