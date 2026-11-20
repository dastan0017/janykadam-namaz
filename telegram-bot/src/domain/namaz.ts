import type { PrayerName } from './prayer';

/**
 * Фиксированные темы-намазы. Одинаковые во всех марафонах и не редактируются
 * ни админом, ни куратором: марафон только выбирает, какие из них использует.
 * Идентификаторы стабильны и зашиты в код; таблица namaz_topics — их зеркало.
 */

export type NamazId = 't1' | 't2' | 't3' | 't4' | 't5' | 't6' | 't11';

/**
 * Граница окна.
 * - `prayer` — время намаза в тот же день плюс смещение в минутах;
 * - `nextPrayer` — время намаза следующего локального дня;
 * - `fixed` — минуты от местной полуночи.
 */
export type Edge =
  | { kind: 'prayer'; prayer: PrayerName; offsetMin: number }
  | { kind: 'nextPrayer'; prayer: PrayerName; offsetMin: number }
  | { kind: 'fixed'; minutes: number };

export interface NamazTopicDef {
  id: NamazId;
  emoji: string;
  nameKg: string;
  nameRu: string;
  opens: Edge;
  closes: Edge;
  /** Не открывать раньше вечерней иши предыдущего дня (только Тахажуд). */
  notBeforePrevIsha?: boolean;
  ruleKg: string;
  ruleRu: string;
  points: number;
  mandatory: boolean;
  /** Требует согласия командой /tahajjud: окно попадает в тихие часы. */
  optIn?: boolean;
}

export const NAMAZ_TOPICS: readonly NamazTopicDef[] = [
  {
    id: 't1',
    emoji: '🌙',
    nameKg: 'Тахажуд',
    nameRu: 'Тахаджуд',
    opens: { kind: 'prayer', prayer: 'fajr', offsetMin: -150 },
    closes: { kind: 'prayer', prayer: 'fajr', offsetMin: 0 },
    notBeforePrevIsha: true,
    ruleKg: 'Багымдатка чейин 2,5 саат — Багымдатка чейин',
    ruleRu: 'за 2,5 ч до Багымдата — до Багымдата',
    points: 15,
    mandatory: false,
    optIn: true,
  },
  {
    id: 't2',
    emoji: '🌅',
    nameKg: 'Багымдат',
    nameRu: 'Фаджр',
    opens: { kind: 'prayer', prayer: 'fajr', offsetMin: 0 },
    closes: { kind: 'prayer', prayer: 'sunrise', offsetMin: 0 },
    ruleKg: 'Багымдат — күн чыкканга чейин',
    ruleRu: 'Багымдат — до восхода',
    points: 10,
    mandatory: true,
  },
  {
    id: 't3',
    emoji: '☀️',
    nameKg: 'Пешим',
    nameRu: 'Зухр',
    opens: { kind: 'prayer', prayer: 'dhuhr', offsetMin: 0 },
    closes: { kind: 'prayer', prayer: 'asr', offsetMin: 0 },
    ruleKg: 'Пешим — Асрга чейин',
    ruleRu: 'Пешим — до Асра',
    points: 10,
    mandatory: true,
  },
  {
    id: 't4',
    emoji: '🌤',
    nameKg: 'Аср',
    nameRu: 'Аср',
    opens: { kind: 'prayer', prayer: 'asr', offsetMin: 0 },
    closes: { kind: 'prayer', prayer: 'maghrib', offsetMin: 0 },
    ruleKg: 'Аср — Шамга чейин',
    ruleRu: 'Аср — до Шама',
    points: 10,
    mandatory: true,
  },
  {
    id: 't5',
    emoji: '🌇',
    nameKg: 'Шам',
    nameRu: 'Магриб',
    opens: { kind: 'prayer', prayer: 'maghrib', offsetMin: 0 },
    closes: { kind: 'prayer', prayer: 'isha', offsetMin: 0 },
    ruleKg: 'Шам — Куптанга чейин',
    ruleRu: 'Шам — до Куптана',
    points: 10,
    mandatory: true,
  },
  {
    // Иша действует до фаджра. «До полуночи» на северных широтах летом оставляло
    // бы меньше часа: в Петербурге 21 июня иша ≈ 23:10 даже с высокоширотным правилом.
    id: 't6',
    emoji: '🌃',
    nameKg: 'Куптан',
    nameRu: 'Иша',
    opens: { kind: 'prayer', prayer: 'isha', offsetMin: 0 },
    closes: { kind: 'nextPrayer', prayer: 'fajr', offsetMin: 0 },
    ruleKg: 'Куптан — эртеңки Багымдатка чейин',
    ruleRu: 'Куптан — до следующего Багымдата',
    points: 10,
    mandatory: true,
  },
  {
    id: 't11',
    emoji: '🕌',
    nameKg: 'Каза намаз',
    nameRu: 'Восполнение намазов',
    opens: { kind: 'fixed', minutes: 5 * 60 },
    closes: { kind: 'fixed', minutes: 23 * 60 },
    ruleKg: 'Күн бою, 05:00–23:00',
    ruleRu: 'весь день, 05:00–23:00',
    points: 10,
    mandatory: false,
  },
] as const;

export const NAMAZ_BY_ID: ReadonlyMap<NamazId, NamazTopicDef> = new Map(NAMAZ_TOPICS.map((n) => [n.id, n]));

export const NAMAZ_IDS: readonly NamazId[] = NAMAZ_TOPICS.map((n) => n.id);

export function isNamazId(id: string): id is NamazId {
  return NAMAZ_BY_ID.has(id as NamazId);
}

/** Единственный вопрос Каза намаза — обязательный числовой. */
export const KAZA_QUESTION = {
  namazId: 't11' as NamazId,
  position: 0,
  textKg: 'Канча каза намаз окудуңуз?',
  textRu: 'Сколько намазов восполнили?',
  type: 'number' as const,
  required: true,
};
