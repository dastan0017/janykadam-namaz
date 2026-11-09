import type { MarathonStatus, NamazDef, ParticipantStatus, QuestionType, Screen, TzKey } from '../types';

/**
 * Время намазов на 8 ноября 2026, минуты от полуночи по местному времени.
 * Метод ДУМ России (Фаджр 16°, Иша 15°), Аср по ханафитскому мазхабу —
 * как вернул бы Aladhan API (method=14, school=1).
 */
export interface TzInfo {
  city: string;
  utc: string;
  note: string;
  /** Смещение относительно Бишкека в минутах. */
  off: number;
  pt: { fajr: number; sunrise: number; dhuhr: number; asr: number; maghrib: number; isha: number };
}

export const TZ: Record<TzKey, TzInfo> = {
  bishkek: { city: 'Бишкек', utc: 'UTC+6', note: 'Чүй, Ысык-Көл, Нарын, Талас', off: 0, pt: { fajr: 379, sunrise: 464, dhuhr: 765, asr: 963, maghrib: 1066, isha: 1146 } },
  osh: { city: 'Ош', utc: 'UTC+6', note: 'Ош, Жалал-Абад, Баткен', off: 0, pt: { fajr: 384, sunrise: 467, dhuhr: 773, asr: 977, maghrib: 1078, isha: 1155 } },
  almaty: { city: 'Алматы', utc: 'UTC+5', note: 'Казахстан', off: -60, pt: { fajr: 310, sunrise: 396, dhuhr: 696, asr: 893, maghrib: 996, isha: 1077 } },
  moscow: { city: 'Москва', utc: 'UTC+3', note: 'Россия, европейская часть', off: -180, pt: { fajr: 356, sunrise: 470, dhuhr: 733, asr: 883, maghrib: 996, isha: 1102 } },
  istanbul: { city: 'Стамбул', utc: 'UTC+3', note: 'Турция', off: -180, pt: { fajr: 380, sunrise: 463, dhuhr: 768, asr: 971, maghrib: 1072, isha: 1150 } },
  seoul: { city: 'Сеул', utc: 'UTC+9', note: 'Корея', off: 180, pt: { fajr: 345, sunrise: 424, dhuhr: 736, asr: 948, maghrib: 1047, isha: 1121 } },
  newyork: { city: 'Нью-Йорк', utc: 'UTC−5', note: 'США, восточное время', off: -660, pt: { fajr: 312, sunrise: 395, dhuhr: 700, asr: 903, maghrib: 1004, isha: 1082 } },
};

export const TZ_ORDER: TzKey[] = ['bishkek', 'osh', 'almaty', 'moscow', 'istanbul', 'seoul', 'newyork'];

/** «Сейчас» в прототипе — 09:40 по Бишкеку. */
export const NOW = 580;

/** Фиксированные темы-намазы: одинаковые во всех марафонах, в марафоне их только выбирают. */
export const NAMAZ: NamazDef[] = [
  { id: 't1', emoji: '🌙', nameKg: 'Тахажуд', nameRu: 'Тахаджуд', s: ['fajr', -150], e: ['fajr', 0], rule: 'за 2,5 ч до Багымдата — до Багымдата', points: 15, mandatory: false },
  { id: 't2', emoji: '🌅', nameKg: 'Багымдат', nameRu: 'Фаджр', s: ['fajr', 0], e: ['sunrise', 0], rule: 'Багымдат — до восхода', points: 10, mandatory: true },
  { id: 't3', emoji: '☀️', nameKg: 'Пешим', nameRu: 'Зухр', s: ['dhuhr', 0], e: ['asr', 0], rule: 'Пешим — до Асра', points: 10, mandatory: true },
  { id: 't4', emoji: '🌤', nameKg: 'Аср', nameRu: 'Аср', s: ['asr', 0], e: ['maghrib', 0], rule: 'Аср — до Шама', points: 10, mandatory: true },
  { id: 't5', emoji: '🌇', nameKg: 'Шам', nameRu: 'Магриб', s: ['maghrib', 0], e: ['isha', 0], rule: 'Шам — до Куптана', points: 10, mandatory: true },
  { id: 't6', emoji: '🌃', nameKg: 'Куптан', nameRu: 'Иша', s: ['isha', 0], e: ['midnight', 0], rule: 'Куптан — до полуночи', points: 10, mandatory: true },
  {
    id: 't11', emoji: '🕌', nameKg: 'Каза намаз', nameRu: 'Восполнение намазов', s: ['fixed', 300], e: ['fixed', 1380],
    rule: 'весь день, 05:00–23:00 · вопрос «сколько восполнили»', points: 10, mandatory: false,
    questions: [{ id: 'q1', textKg: 'Канча каза намаз окудуңуз?', textRu: 'Сколько намазов восполнили?', type: 'number', required: true, options: [] }],
  },
];

export const QTYPE: Record<QuestionType, string> = {
  single: 'Один вариант',
  multi: 'Несколько',
  text: 'Текст',
  number: 'Число',
  scale: 'Шкала 1–5',
  yesno: 'Да / нет',
};

/** Статус марафона: подпись, цвет текста, цвет фона. */
export const STATUS: Record<MarathonStatus, [string, string, string]> = {
  draft: ['Черновик', '#645c50', '#eee7db'],
  recruiting: ['Набор', '#56633f', '#e1eecc'],
  running: ['Идёт', '#8c491a', '#ffe1d0'],
  finished: ['Завершён', '#474238', '#dcd3c4'],
  archive: ['Архив', '#645c50', '#f9f4ed'],
};

export const PSTATUS: Record<ParticipantStatus, [string, string, string]> = {
  active: ['Активна', '#56633f', '#e1eecc'],
  paused: ['Пауза', '#8c491a', '#ffe1d0'],
  left: ['Вышла', '#645c50', '#eee7db'],
  finished: ['Завершила', '#474238', '#dcd3c4'],
};

export const ICONS: Record<string, string> = {
  all: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  overview: 'M3 12h4l3-8 4 16 3-8h4',
  topics: 'M10 6h11M10 12h11M10 18h11M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17',
  participants: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  broadcasts: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  analytics: 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  namaz: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  texts: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 8h8M8 12h5',
  bot: 'M12 8V4H8M5 8h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM2 14h2M20 14h2M9 13v2M15 13v2',
  users: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  journal: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
};

/** Экраны вне контекста марафона — при переключении марафона с них не уводит. */
export const GLOBAL: Screen[] = ['marathons', 'bot', 'texts', 'namaz', 'users', 'journal'];

/** Группа экрана в навигации: марафон, бот (общее), система, все марафоны. */
export const GROUP: Record<Screen, 'all' | 'm' | 'bot' | 'sys'> = {
  marathons: 'all',
  overview: 'm',
  topics: 'm',
  topicEditor: 'm',
  questionEditor: 'm',
  participants: 'm',
  broadcasts: 'm',
  analytics: 'm',
  settings: 'm',
  namaz: 'bot',
  texts: 'bot',
  bot: 'bot',
  users: 'sys',
  journal: 'sys',
};

export const SCREEN_TITLES: Record<Screen, string> = {
  marathons: 'Все марафоны',
  overview: 'Обзор',
  topics: 'Темы',
  topicEditor: 'Редактор темы',
  questionEditor: 'Редактор вопроса',
  participants: 'Участницы',
  broadcasts: 'Рассылки',
  analytics: 'Аналитика',
  texts: 'Тексты бота',
  bot: 'Настройки бота',
  namaz: 'Время намазов',
  users: 'Пользователи',
  journal: 'Журнал изменений',
  settings: 'Настройки марафона',
};

/** Сегодняшний день прототипа — для «новых сегодня» и записей в журнал. */
export const TODAY_LABEL = '8 ноя';
/** День марафона «Үммөттүн кызы» на эту дату. */
export const DAY_N = 20;
export const MARATHON_DAYS = 30;
