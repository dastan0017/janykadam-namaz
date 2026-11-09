import { DateTime } from 'luxon';
import { NAMAZ_BY_ID, type Edge, type NamazId, type NamazTopicDef } from './namaz';
import type { PrayerInstants } from './prayer';

/**
 * Окна сдачи и ключи дня.
 *
 * Окно полуоткрытое: [opens, closes). Окно может пересекать местную полночь —
 * отчёт всегда относится к ключу дня своего окна, а не к календарной дате отправки.
 */

export type TopicKind = 'namaz' | 'custom';

/** Ключ дня — локальная календарная дата YYYY-MM-DD. */
export type DayKey = string;

export interface CustomTopicDef {
  id: string;
  position: number;
  emoji: string;
  nameKg: string;
  nameRu: string;
  /** HH:MM в местном времени участницы, одинаково каждый день. */
  startLocal: string;
  endLocal: string;
  points: number;
  freq: 'daily' | 'weekly';
  mandatory: boolean;
  remindOffsetMin: number;
}

export interface WindowInstance {
  topicKind: TopicKind;
  topicId: string;
  dayKey: DayKey;
  opensAt: Date;
  closesAt: Date;
  mandatory: boolean;
  points: number;
  emoji: string;
  nameKg: string;
  nameRu: string;
  /** Напоминание шлётся только согласившимся (Тахажуд). */
  optIn: boolean;
  remindOffsetMin: number;
}

/** Времена намаза для конкретной локальной даты. Реализация кэширует их снаружи. */
export type PrayerLookup = (localDate: string) => PrayerInstants;

export function toLocalDate(instant: Date, tz: string): DayKey {
  return DateTime.fromJSDate(instant, { zone: tz }).toFormat('yyyy-MM-dd');
}

export function localDateShift(dayKey: DayKey, days: number): DayKey {
  return DateTime.fromISO(dayKey, { zone: 'utc' }).plus({ days }).toFormat('yyyy-MM-dd');
}

/** HH:MM локальной даты в момент UTC. */
export function localTimeToInstant(dayKey: DayKey, minutes: number, tz: string): Date {
  return DateTime.fromISO(dayKey, { zone: tz }).startOf('day').plus({ minutes }).toUTC().toJSDate();
}

export function parseHHMM(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Ожидается время вида HH:MM, получено: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatLocal(instant: Date, tz: string): string {
  return DateTime.fromJSDate(instant, { zone: tz }).toFormat('HH:mm');
}

function resolveEdge(edge: Edge, dayKey: DayKey, tz: string, prayers: PrayerLookup): Date {
  switch (edge.kind) {
    case 'prayer':
      return new Date(prayers(dayKey)[edge.prayer].getTime() + edge.offsetMin * 60_000);
    case 'nextPrayer':
      return new Date(prayers(localDateShift(dayKey, 1))[edge.prayer].getTime() + edge.offsetMin * 60_000);
    case 'fixed':
      return localTimeToInstant(dayKey, edge.minutes, tz);
  }
}

/** Окно одной темы-намаза для одного ключа дня. */
export function namazWindow(def: NamazTopicDef, dayKey: DayKey, tz: string, prayers: PrayerLookup): WindowInstance {
  let opensAt = resolveEdge(def.opens, dayKey, tz, prayers);
  const closesAt = resolveEdge(def.closes, dayKey, tz, prayers);

  // Тахажуд не открывается раньше вчерашней иши.
  if (def.notBeforePrevIsha) {
    const prevIsha = prayers(localDateShift(dayKey, -1)).isha;
    if (opensAt.getTime() < prevIsha.getTime()) opensAt = prevIsha;
  }

  return {
    topicKind: 'namaz',
    topicId: def.id,
    dayKey,
    opensAt,
    closesAt,
    mandatory: def.mandatory,
    points: def.points,
    emoji: def.emoji,
    nameKg: def.nameKg,
    nameRu: def.nameRu,
    optIn: def.optIn ?? false,
    remindOffsetMin: 0,
  };
}

/** Окно кастомной темы для одного ключа дня. */
export function customWindow(def: CustomTopicDef, dayKey: DayKey, tz: string): WindowInstance {
  return {
    topicKind: 'custom',
    topicId: def.id,
    dayKey,
    opensAt: localTimeToInstant(dayKey, parseHHMM(def.startLocal), tz),
    closesAt: localTimeToInstant(dayKey, parseHHMM(def.endLocal), tz),
    mandatory: def.mandatory,
    points: def.points,
    emoji: def.emoji,
    nameKg: def.nameKg,
    nameRu: def.nameRu,
    optIn: false,
    remindOffsetMin: def.remindOffsetMin,
  };
}

export interface EnabledTopics {
  namaz: readonly NamazId[];
  custom: readonly CustomTopicDef[];
}

/** Все окна тем марафона для одного ключа дня, в порядке показа. */
export function windowsForDay(topics: EnabledTopics, dayKey: DayKey, tz: string, prayers: PrayerLookup): WindowInstance[] {
  const out: WindowInstance[] = [];

  // Намазы — в порядке времени суток, как в библиотеке.
  for (const id of topics.namaz) {
    const def = NAMAZ_BY_ID.get(id);
    if (def) out.push(namazWindow(def, dayKey, tz, prayers));
  }
  // Кастомные — по position.
  for (const def of [...topics.custom].sort((a, b) => a.position - b.position)) {
    out.push(customWindow(def, dayKey, tz));
  }
  return out;
}

/**
 * Окна, которые могут содержать момент `at`.
 *
 * Берём три локальные даты вокруг него: окно Куптана дня D тянется в D+1, а
 * Тахажуд дня D на высоких широтах может открыться ещё вечером D−1.
 */
export function windowsAround(topics: EnabledTopics, at: Date, tz: string, prayers: PrayerLookup): WindowInstance[] {
  const today = toLocalDate(at, tz);
  return [localDateShift(today, -1), today, localDateShift(today, 1)].flatMap((d) => windowsForDay(topics, d, tz, prayers));
}

export function isOpenAt(w: WindowInstance, at: Date): boolean {
  return w.opensAt.getTime() <= at.getTime() && at.getTime() < w.closesAt.getTime();
}

/** Окна, открытые в момент `at`, в порядке показа. */
export function openWindowsAt(topics: EnabledTopics, at: Date, tz: string, prayers: PrayerLookup): WindowInstance[] {
  return windowsAround(topics, at, tz, prayers).filter((w) => isOpenAt(w, at));
}

/** Ближайшее окно, которое откроется после `at`. */
export function nextWindowAfter(topics: EnabledTopics, at: Date, tz: string, prayers: PrayerLookup): WindowInstance | null {
  const future = windowsAround(topics, at, tz, prayers)
    .filter((w) => w.opensAt.getTime() > at.getTime())
    .sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
  return future[0] ?? null;
}

/**
 * Окна ключа дня `dayKey`, которые уже закрылись к моменту `at`, —
 * кандидаты на позднюю сдачу.
 */
export function closedWindowsOfDay(
  topics: EnabledTopics,
  dayKey: DayKey,
  at: Date,
  tz: string,
  prayers: PrayerLookup,
): WindowInstance[] {
  return windowsForDay(topics, dayKey, tz, prayers).filter((w) => w.closesAt.getTime() <= at.getTime());
}

/**
 * Момент, после которого ключ дня можно оценивать: закрылось последнее
 * обязательное окно этого дня (для Куптана — следующий фаджр).
 */
export function dayEvaluationAt(topics: EnabledTopics, dayKey: DayKey, tz: string, prayers: PrayerLookup): Date | null {
  const mandatory = windowsForDay(topics, dayKey, tz, prayers).filter((w) => w.mandatory);
  if (mandatory.length === 0) return null;
  return new Date(Math.max(...mandatory.map((w) => w.closesAt.getTime())));
}

/** Номер дня марафона в местном времени участницы: 1 — день старта. */
export function marathonDayNumber(startDate: string, dayKey: DayKey): number {
  const start = DateTime.fromISO(startDate, { zone: 'utc' });
  const day = DateTime.fromISO(dayKey, { zone: 'utc' });
  return Math.floor(day.diff(start, 'days').days) + 1;
}

/** Ключ ISO-недели — для тем с частотой `weekly`. */
export function isoWeekKey(dayKey: DayKey): string {
  const d = DateTime.fromISO(dayKey, { zone: 'utc' });
  return `${d.weekYear}-W${String(d.weekNumber).padStart(2, '0')}`;
}
