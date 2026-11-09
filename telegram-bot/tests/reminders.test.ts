import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { decideReminder, isQuietAt, reminderInstant, shiftOutOfQuiet, type ReminderCheck } from '../src/domain/reminders';

const TZ = 'Asia/Bishkek';
const at = (local: string) => DateTime.fromISO(local, { zone: TZ }).toJSDate();

describe('тихие часы', () => {
  it('окно через полночь захватывает обе половины ночи', () => {
    expect(isQuietAt(at('2026-11-08T23:00'), TZ, '22:30', '04:30')).toBe(true);
    expect(isQuietAt(at('2026-11-08T02:00'), TZ, '22:30', '04:30')).toBe(true);
  });

  it('день не тихий', () => {
    expect(isQuietAt(at('2026-11-08T09:40'), TZ, '22:30', '04:30')).toBe(false);
    expect(isQuietAt(at('2026-11-08T21:00'), TZ, '22:30', '04:30')).toBe(false);
  });

  it('границы: начало включается, конец нет', () => {
    expect(isQuietAt(at('2026-11-08T22:30'), TZ, '22:30', '04:30')).toBe(true);
    expect(isQuietAt(at('2026-11-08T04:30'), TZ, '22:30', '04:30')).toBe(false);
    expect(isQuietAt(at('2026-11-08T04:29'), TZ, '22:30', '04:30')).toBe(true);
  });

  it('окно внутри суток тоже работает', () => {
    expect(isQuietAt(at('2026-11-08T13:00'), TZ, '12:00', '14:00')).toBe(true);
    expect(isQuietAt(at('2026-11-08T15:00'), TZ, '12:00', '14:00')).toBe(false);
  });

  it('считается по местному времени участницы', () => {
    const instant = at('2026-11-08T23:00');
    expect(isQuietAt(instant, TZ, '22:30', '04:30')).toBe(true);
    // Тот же момент в Москве — 20:00, ещё не тихо.
    expect(isQuietAt(instant, 'Europe/Moscow', '22:30', '04:30')).toBe(false);
  });
});

describe('перенос из тихих часов', () => {
  it('ночью переносит на конец тихих часов того же утра', () => {
    const shifted = shiftOutOfQuiet(at('2026-11-08T02:00'), TZ, '22:30', '04:30');
    expect(DateTime.fromJSDate(shifted, { zone: TZ }).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-08 04:30');
  });

  it('поздним вечером переносит на утро следующего дня', () => {
    const shifted = shiftOutOfQuiet(at('2026-11-08T23:00'), TZ, '22:30', '04:30');
    expect(DateTime.fromJSDate(shifted, { zone: TZ }).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-09 04:30');
  });

  it('вне тихих часов момент не меняется', () => {
    const instant = at('2026-11-08T09:40');
    expect(shiftOutOfQuiet(instant, TZ, '22:30', '04:30').getTime()).toBe(instant.getTime());
  });
});

describe('момент напоминания', () => {
  const opens = new Date('2026-11-08T01:00:00Z');
  const closes = new Date('2026-11-08T03:00:00Z');

  it('при открытии окна', () => {
    expect(reminderInstant(opens, closes, 0).toISOString()).toBe('2026-11-08T01:00:00.000Z');
  });

  it('через 30 минут после открытия', () => {
    expect(reminderInstant(opens, closes, 30).toISOString()).toBe('2026-11-08T01:30:00.000Z');
  });

  it('за 30 минут до закрытия', () => {
    expect(reminderInstant(opens, closes, -30).toISOString()).toBe('2026-11-08T02:30:00.000Z');
  });
});

describe('решение об отправке', () => {
  const ok: ReminderCheck = {
    enrollmentActive: true, paused: false, blocked: false, topicEnabled: true,
    alreadyReported: false, windowClosed: false, quiet: false,
    sentToday: 0, capPerDay: 6, optIn: false, optedIn: false,
  };

  it('в обычном случае отправляем', () => {
    expect(decideReminder(ok).send).toBe(true);
  });

  it('не отправляем уже сдавшей', () => {
    expect(decideReminder({ ...ok, alreadyReported: true })).toEqual({ send: false, reason: 'already_reported' });
  });

  it('не отправляем в тихие часы', () => {
    expect(decideReminder({ ...ok, quiet: true })).toEqual({ send: false, reason: 'quiet' });
  });

  it('не отправляем на паузе и заблокировавшей бота', () => {
    expect(decideReminder({ ...ok, paused: true }).reason).toBe('paused');
    expect(decideReminder({ ...ok, blocked: true }).reason).toBe('blocked');
  });

  it('не отправляем, если тему выключили', () => {
    expect(decideReminder({ ...ok, topicEnabled: false }).reason).toBe('topic_off');
  });

  it('дневной лимит останавливает отправку', () => {
    expect(decideReminder({ ...ok, sentToday: 6, capPerDay: 6 }).reason).toBe('cap');
    expect(decideReminder({ ...ok, sentToday: 5, capPerDay: 6 }).send).toBe(true);
  });

  it('Тахажуд обходит тихие часы и лимит, но только для согласившихся', () => {
    const tahajjud = { ...ok, optIn: true, quiet: true, sentToday: 99 };
    expect(decideReminder({ ...tahajjud, optedIn: true }).send).toBe(true);
    expect(decideReminder({ ...tahajjud, optedIn: false })).toEqual({ send: false, reason: 'opt_in' });
  });

  it('закрытое окно не напоминаем', () => {
    expect(decideReminder({ ...ok, windowClosed: true }).reason).toBe('window_closed');
  });
});
