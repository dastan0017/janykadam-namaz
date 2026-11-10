import type { MarathonStatus, NamazDef, ParticipantStatus, QuestionType, Screen, TzKey } from '../types';

/**
 * Справочные данные панели.
 *
 * Время намазов и список поясов приходят из бэкенда (`GET /api/prayer/presets`)
 * и кладутся сюда один раз при загрузке: это общие данные только для чтения, а
 * расчёты окон в экранах синхронные. До загрузки реестр пуст, и панель показывает
 * заглушку — поэтому `TZ[k]` всюду читается с запасным значением.
 */
export interface TzInfo {
  city: string;
  utc: string;
  note: string;
  /** Время намазов на сегодня, минуты от местной полуночи. */
  pt: { fajr: number; sunrise: number; dhuhr: number; asr: number; maghrib: number; isha: number };
}

/** Ключ — зона IANA, как её хранит бот: `Asia/Bishkek`. */
export const TZ: Record<string, TzInfo> = {};

/** Порядок поясов в фильтрах и таблицах — как их отдал бэкенд. */
export const TZ_ORDER: TzKey[] = [];

/**
 * Пресеты места в том виде, в каком их показывает бот при регистрации.
 * Отличается от `TZ_ORDER`: Бишкек и Ош — разные кнопки, но одна зона.
 */
export const PRESETS: { label: string; tz: string; pt: TzInfo['pt'] }[] = [];

/**
 * Заполняется из `/api/prayer/presets`. Сами объекты не подменяются, чтобы
 * ссылки, взятые при импорте модуля, остались валидными.
 */
export function setPrayerPresets(presets: { tz: string; city: string; pt: TzInfo['pt'] }[]): void {
  for (const key of Object.keys(TZ)) delete TZ[key];
  TZ_ORDER.length = 0;
  PRESETS.length = 0;
  for (const p of presets) {
    PRESETS.push({ label: p.city, tz: p.tz, pt: p.pt });
    // Несколько городов могут лежать в одной зоне (Бишкек и Ош): в реестре
    // остаётся первый. Времена здесь зонные и приблизительные — точные окна
    // участницы считает бэкенд по её координатам.
    if (TZ[p.tz]) continue;
    TZ[p.tz] = { city: p.city, utc: utcLabel(p.tz), note: '', pt: p.pt };
    TZ_ORDER.push(p.tz);
  }
}

/** Пояс, который показываем, пока справочник не загружен. */
export const FALLBACK_TZ = 'Asia/Bishkek';

/**
 * «UTC+6» для зоны IANA. Считается по текущему смещению, поэтому Нью-Йорк
 * сам меняется с UTC−4 на UTC−5 при переходе на зимнее время.
 */
export function utcLabel(tz: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!name) return tz;
    const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
    if (!m) return 'UTC';
    const hours = Number(m[2]);
    const sign = m[1] === '-' ? '−' : '+';
    return `UTC${sign}${hours}${m[3] === '00' ? '' : ':' + m[3]}`;
  } catch {
    return tz;
  }
}

/** Фиксированные темы-намазы: одинаковые во всех марафонах, в марафоне их только выбирают. */
export const NAMAZ: NamazDef[] = [
  { id: 't1', emoji: '🌙', nameKg: 'Тахажуд', nameRu: 'Тахаджуд', s: ['fajr', -150], e: ['fajr', 0], rule: 'за 2,5 ч до Багымдата — до Багымдата', points: 15, mandatory: false },
  { id: 't2', emoji: '🌅', nameKg: 'Багымдат', nameRu: 'Фаджр', s: ['fajr', 0], e: ['sunrise', 0], rule: 'Багымдат — до восхода', points: 10, mandatory: true },
  { id: 't3', emoji: '☀️', nameKg: 'Пешим', nameRu: 'Зухр', s: ['dhuhr', 0], e: ['asr', 0], rule: 'Пешим — до Асра', points: 10, mandatory: true },
  { id: 't4', emoji: '🌤', nameKg: 'Аср', nameRu: 'Аср', s: ['asr', 0], e: ['maghrib', 0], rule: 'Аср — до Шама', points: 10, mandatory: true },
  { id: 't5', emoji: '🌇', nameKg: 'Шам', nameRu: 'Магриб', s: ['maghrib', 0], e: ['isha', 0], rule: 'Шам — до Куптана', points: 10, mandatory: true },
  // Окно Куптана идёт до следующего фаджра, а не до полуночи: на северных
  // широтах летом иша наступает в 23:10 и «до полуночи» оставляло бы меньше часа.
  // Так же считает и бот — расхождение здесь означало бы неверное превью.
  { id: 't6', emoji: '🌃', nameKg: 'Куптан', nameRu: 'Иша', s: ['isha', 0], e: ['nextFajr', 0], rule: 'Куптан — до следующего Багымдата', points: 10, mandatory: true },
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

/** Сколько дней идёт марафон по умолчанию — длина берётся из его дат. */
export const MARATHON_DAYS = 30;
