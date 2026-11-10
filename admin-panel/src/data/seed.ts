import type { AppState, Participant, ParticipantStatus, Topic, TzKey } from '../types';
import { setPrayerPresets } from './constants';
import { initialState } from './initial';
import { localDate } from '../lib/time';

/**
 * Фикстуры для разработки без бэкенда (`VITE_USE_SEED=true`).
 * Это не источник данных панели: с живым ботом всё приходит из API.
 */

/** Сегодня по Бишкеку — «новые сегодня» в фикстурах должны оставаться новыми. */
const TODAY = localDate('Asia/Bishkek');

/** Время намазов прототипа: с бэкендом его отдаёт `/api/prayer/presets`. */
const SEED_PRESETS = [
  { tz: 'Asia/Bishkek', city: 'Бишкек', pt: { fajr: 379, sunrise: 464, dhuhr: 765, asr: 963, maghrib: 1066, isha: 1146 } },
  { tz: 'Asia/Almaty', city: 'Алматы', pt: { fajr: 310, sunrise: 396, dhuhr: 696, asr: 893, maghrib: 996, isha: 1077 } },
  { tz: 'Europe/Moscow', city: 'Москва', pt: { fajr: 356, sunrise: 470, dhuhr: 733, asr: 883, maghrib: 996, isha: 1102 } },
  { tz: 'Europe/Istanbul', city: 'Стамбул', pt: { fajr: 380, sunrise: 463, dhuhr: 768, asr: 971, maghrib: 1072, isha: 1150 } },
  { tz: 'Asia/Seoul', city: 'Сеул', pt: { fajr: 345, sunrise: 424, dhuhr: 736, asr: 948, maghrib: 1047, isha: 1121 } },
  { tz: 'America/New_York', city: 'Нью-Йорк', pt: { fajr: 312, sunrise: 395, dhuhr: 700, asr: 903, maghrib: 1004, isha: 1082 } },
];

const topic = (o: Partial<Topic> & Pick<Topic, 'id' | 'nameKg'>): Topic => ({
  emoji: '🕊',
  nameRu: '',
  active: true,
  mode: 'fixed',
  start: '05:00',
  end: '22:00',
  points: 10,
  freq: 'daily',
  mandatory: false,
  remind: 0,
  questions: [],
  ...o,
});

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const participant = (
  id: string,
  name: string,
  user: string,
  tz: TzKey,
  status: ParticipantStatus,
  points: number,
  streak: number,
  last: number,
  today: string[],
  extra: Partial<Participant> = {},
): Participant => ({ id, name, user, tz, place: tz.split('/').pop()?.replace(/_/g, ' ') ?? '', status, points, streak, last, today, lang: 'kg', blocked: false, joined: '2026-10-20', d7: true, goal: '', ...extra });

/** Свои темы марафона. Намазы (t1–t6, t11) — в фиксированной библиотеке NAMAZ. */
const topics5 = (): Topic[] => [
  topic({ id: 't7', emoji: '📿', nameKg: 'Зикир', nameRu: 'Зикр', start: '05:00', end: '23:00', points: 5 }),
  topic({ id: 't8', emoji: '📝', nameKg: 'Күндү пландоо', nameRu: 'Планирование дня', start: '05:00', end: '10:00', points: 5 }),
  topic({ id: 't9', emoji: '🏃‍♀️', nameKg: 'Спорт', nameRu: 'Спорт', start: '06:00', end: '22:00', points: 10 }),
  topic({
    id: 't10', emoji: '📖', nameKg: 'Китеп окуу', nameRu: 'Чтение книги', start: '05:00', end: '23:00', points: 0,
    questions: [{
      id: 'q1', textKg: 'Канча бет окудуңуз?', textRu: 'Сколько страниц прочитали?', type: 'single', required: true,
      options: [
        { id: 'o1', kg: '1 бет', ru: '1 страница', pts: 3 },
        { id: 'o2', kg: '2–5 бет', ru: '2–5 страниц', pts: 4 },
        { id: 'o3', kg: '5+ бет', ru: '5+ страниц', pts: 5 },
      ],
    }],
  }),
  topic({
    id: 't12', emoji: '🌠', nameKg: 'Күндү анализдөө', nameRu: 'Анализ дня', start: '20:00', end: '23:59', points: 5,
    questions: [
      {
        id: 'q1', textKg: 'Бүгүнкү күнүңүздү кандай баалайсыз?', textRu: 'Как оцениваете свой день?', type: 'scale', required: true,
        options: [1, 2, 3, 4, 5].map((n) => ({ id: 'o' + n, kg: String(n), ru: String(n), pts: 1, locked: true })),
      },
      { id: 'q2', textKg: 'Эртең эмнени жакшыртасыз?', textRu: '', type: 'text', required: false, options: [] },
    ],
  }),
];

const ALL_NAMAZ = ['t1', 't2', 't3', 't4', 't5', 't6', 't11'];

const parts5 = (): Participant[] => [
  participant('p1', 'Айжан Турдубекова', '@aijan_t', 'Asia/Bishkek', 'active', 412, 19, 0, ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't10']),
  participant('p2', 'Нургүл Асанова', '@nurgul_a', 'Asia/Bishkek', 'active', 388, 12, 0, ['t2', 't3', 't4', 't5', 't6', 't10']),
  participant('p3', 'Мээрим Сыдыкова', '@meerim_s', 'Asia/Bishkek', 'active', 301, 4, 0, ['t2', 't3', 't4', 't5', 't6']),
  participant('p4', 'Жылдыз Бакирова', '@jyldyz_b', 'Asia/Bishkek', 'active', 356, 0, 1, []),
  participant('p5', 'Айпери Токтосунова', '@aiperi_t', 'Asia/Bishkek', 'active', 402, 20, 0, ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't12']),
  participant('p6', 'Гүлзат Мамбетова', '@gulzat_m', 'Europe/Moscow', 'active', 214, 0, 4, [], { lang: 'ru' }),
  participant('p7', 'Алтынай Осмонова', '@altynai_o', 'Europe/Istanbul', 'active', 377, 9, 0, ['t2', 't3', 't4', 't5', 't6', 't9']),
  participant('p8', 'Чолпон Эсенова', '@cholpon_e', 'Asia/Seoul', 'active', 165, 0, 6, [], { d7: false }),
  participant('p9', 'Бегимай Абдылдаева', '@begimai_a', 'Asia/Bishkek', 'active', 340, 7, 0, ['t2', 't3', 't4', 't5', 't6', 't10', 't11']),
  participant('p10', 'Айдана Жумабекова', '@aidana_j', 'Asia/Almaty', 'active', 395, 15, 0, ['t2', 't3', 't4', 't5', 't6', 't7']),
  participant('p11', 'Назира Калыкова', '@nazira_k', 'Asia/Bishkek', 'paused', 120, 0, 9, [], { blocked: true, lang: 'ru' }),
  participant('p12', 'Элнура Шералиева', '@elnura_sh', 'Asia/Bishkek', 'left', 48, 0, 15, [], { d7: false }),
  participant('p13', 'Сезим Кадырбекова', '@sezim_k', 'Europe/Moscow', 'active', 10, 1, 0, ['t2'], { joined: TODAY, d7: false }),
  participant('p14', 'Айсулуу Маратова', '@aisuluu_m', 'Asia/Bishkek', 'active', 5, 1, 0, ['t8'], { joined: TODAY, d7: false }),
];

const parts4 = (): Participant[] => [
  participant('p41', 'Айгүл Бейшенова', '@aigul_b', 'Asia/Bishkek', 'finished', 598, 0, 0, []),
  participant('p42', 'Салтанат Иманова', '@saltanat_i', 'Asia/Bishkek', 'finished', 541, 0, 0, []),
  participant('p43', 'Динара Кадырова', '@dinara_k', 'Europe/Moscow', 'finished', 467, 0, 0, []),
  participant('p44', 'Асел Мураталиева', '@asel_m', 'Asia/Bishkek', 'finished', 612, 0, 0, []),
  participant('p45', 'Нуриза Жолдошева', '@nuriza_j', 'Asia/Bishkek', 'left', 90, 0, 0, []),
];

const marathonDefaults = {
  lang: 'kg' as const,
  pointsDefault: 10,
  streakBonus: 5,
  streakEvery: 7,
  latePasses: 2,
  excused: 3,
  pauseAllowed: true,
  remindMorning: '05:30',
  remindEvening: '21:00',
  skipSubmitted: true,
};

export function seed(): AppState {
  const t5 = topics5();
  const topics6: Topic[] = [clone(t5[0]), topic({ id: 't13', emoji: '🤲', nameKg: 'Садака', nameRu: '', points: 5 })];

  setPrayerPresets(SEED_PRESETS);

  return {
    ...initialState(),
    auth: 'ready',
    me: { id: 'u1', name: 'Жазгүл Аманова', tg: '@jazgul', role: 'admin' },
    loaded: ['m4', 'm5', 'm6'],
    role: 'admin',
    screen: 'overview',
    mid: 'm5',
    navOpen: false,
    marathons: [
      { id: 'm4', code: 'm4', name: 'Рамазан 2026', status: 'finished', start: '2026-02-18', end: '2026-03-19', regOpen: false, reported: 412, ...marathonDefaults },
      { id: 'm5', code: 'm5', name: 'Үммөттүн кызы', status: 'running', start: '2026-10-20', end: '2026-11-18', regOpen: true, ...marathonDefaults },
      { id: 'm6', code: 'm6', name: 'Кыш марафону', status: 'draft', start: '2026-11-01', end: '2026-11-30', regOpen: true, ...marathonDefaults },
    ],
    data: {
      m4: {
        topics: clone(t5), namaz: [...ALL_NAMAZ], participants: parts4(),
        trend: [62, 70, 74, 78, 80, 79, 81, 83, 80, 82, 84, 83, 81, 85, 86, 84, 83, 85, 87, 86, 84, 83, 85, 86, 88, 87, 86, 85, 88, 90],
        ledger: {}, recent: {}, broadcasts: [],
      },
      m5: {
        topics: t5, namaz: [...ALL_NAMAZ], participants: parts5(),
        trend: [58, 64, 69, 72, 75, 71, 70, 74, 76, 73, 68, 71, 73, 69, 72, 70, 67, 71, 69],
        ledger: {
          p1: [
            { d: '8 ноя', delta: 10, reason: 'Багымдат — отчёт принят' },
            { d: '8 ноя', delta: 15, reason: 'Тахажуд — отчёт принят' },
            { d: '7 ноя', delta: 5, reason: 'Бонус за 7 дней подряд' },
            { d: '7 ноя', delta: 10, reason: 'Куптан — отчёт принят' },
          ],
          p6: [
            { d: '4 ноя', delta: 10, reason: 'Багымдат — отчёт принят' },
            { d: '3 ноя', delta: 0, reason: 'Спорт — отправлено после закрытия окна, не засчитано' },
          ],
          p13: [{ d: '8 ноя', delta: 10, reason: 'Багымдат — первый отчёт сразу после регистрации' }],
        },
        recent: {},
        broadcasts: [
          { id: 'b1', at: '7 ноя, 21:00', text: 'Жума күнүңүз кут болсун! Эртең жумалык жыйынтык чыгат.', seg: 'Все активные', count: 10, delivered: 9, blocked: 1 },
          { id: 'b2', at: '3 ноя, 09:00', text: 'Бүгүн Спорт темасы боюнча окно 06:00–22:00.', seg: 'Не сдали сегодня', count: 4, delivered: 4, blocked: 0 },
        ],
      },
      m6: { topics: topics6, namaz: ['t2'], participants: [], trend: [], ledger: {}, recent: {}, broadcasts: [] },
    },
    users: [
      { id: 'u1', name: 'Жазгүл Аманова', tg: '@jazgul_a', role: 'admin', last: 'сейчас' },
      { id: 'u2', name: 'Айдай Кубатова', tg: '@aidai_k', role: 'admin', last: 'сегодня, 08:12' },
      { id: 'u3', name: 'Мадина Эркинова', tg: '@madina_e', role: 'curator', last: 'вчера, 22:05' },
      { id: 'u4', name: 'Айгерим Сапарова', tg: '@aigerim_s', role: 'curator', last: 'сегодня, 07:41' },
      { id: 'u5', name: 'Назгүл Иса', tg: '@nazgul_i', role: 'curator', last: '5 ноя' },
      { id: 'u6', name: 'Бермет Жусупова', tg: '@bermet_j', role: 'curator', last: '7 ноя' },
      { id: 'u7', name: 'Асель Орозова', tg: '@asel_o', role: 'curator', last: '', invited: true },
    ],
    audit: [
      { at: '8 ноя 07:41', who: 'Айгерим Сапарова', what: 'Рассылка «Бүгүн Китеп окуу унутпайлы» — 12 получателей' },
      { at: '7 ноя 21:00', who: 'Айдай Кубатова', what: 'Рассылка «Жума күнүңүз…» — 10 получателей' },
      { at: '6 ноя 14:12', who: 'Мадина Эркинова', what: 'Изменила окно темы «Спорт»: 06:00–23:00 → 06:00–22:00' },
      { at: '5 ноя 10:03', who: 'Жазгүл Аманова', what: 'Добавила Асель Орозову (@asel_o) как куратора' },
      { at: '2 ноя 09:30', who: 'Жазгүл Аманова', what: 'Начислила +10 Гүлзат Мамбетовой: «сбой бота 1 ноя»' },
      { at: '20 окт 05:00', who: 'система', what: 'Марафон «Үммөттүн кызы» запущен' },
    ],
    texts: [
      { key: 'start_welcome', ru: 'Ассаляму алейкум, {имя}! Вы в марафоне «{марафон}». Сейчас можно сдать: {открыто_сейчас}. Запишите видеокружок — и первый отчёт готов.', kg: 'Ассаляму алейкум, {имя}! Сиз «{марафон}» марафонундасыз. Азыр тапшырса болот: {открыто_сейчас}. Видеокружок жазыңыз — биринчи отчёт даяр.', ph: '{имя} {марафон} {открыто_сейчас}' },
      { key: 'choose_timezone', ru: 'Где вы сейчас? Выберите часовой пояс — по нему бот считает время намазов.', kg: 'Азыр кайдасыз? Убакыт алкагын тандаңыз — бот намаз убактысын ушуга жараша эсептейт.', ph: '' },
      { key: 'choose_marathon', ru: 'Вы участвуете в двух марафонах. Сейчас активен «{марафон}». Переключить: /marafon', kg: 'Сиз эки марафонго катышасыз. Азыр «{марафон}» активдүү. Которуу: /marafon', ph: '{марафон}' },
      { key: 'topic_picker', ru: 'К какой теме этот видеокружок? Показаны темы, открытые сейчас.', kg: 'Бул видеокружок кайсы темага? Азыр ачык темалар көрсөтүлдү.', ph: '' },
      { key: 'video_only', ru: 'Отчёт принимается только видеокружком. Нажмите на микрофон, чтобы он стал камерой, и зажмите для записи.', kg: 'Отчёт видеокружок менен гана кабыл алынат. Микрофонду басып камерага алмаштырыңыз, анан басып кармап жазыңыз.', ph: '' },
      { key: 'report_accepted', ru: '{тема} — отчёт принят. +{баллы} баллов. Всего: {всего}.', kg: '{тема} — отчёт кабыл алынды. +{баллы} балл. Жалпы: {всего}.', ph: '{тема} {баллы} {всего}' },
      { key: 'window_closed', ru: 'Окно «{тема}» закрылось в {конец_окна}. Осталось поздних сдач: {поздние}.', kg: '«{тема}» терезеси {конец_окна} жабылды. Кечиктирип тапшыруу калды: {поздние}.', ph: '{тема} {конец_окна} {поздние}' },
      { key: 'reminder_topic', ru: '{эмодзи} {тема}: окно открыто до {конец_окна}.', kg: '{эмодзи} {тема}: терезе {конец_окна} чейин ачык.', ph: '{эмодзи} {тема} {конец_окна}' },
      { key: 'reminder_morning', ru: 'Доброе утро, {имя}. Сегодня день {день} из 30.', kg: 'Кайырлуу таң, {имя}. Бүгүн 30 күндүн {день}-күнү.', ph: '{имя} {день}' },
      { key: 'reminder_evening', ru: 'До конца дня не сдано: {несданные}.', kg: 'Күндүн аягына чейин тапшырылган жок: {несданные}.', ph: '{несданные}' },
      { key: 'weekly_summary', ru: 'Неделя {неделя}: {сдано} из {всего} отчётов, {баллы} баллов.', kg: '', ph: '{неделя} {сдано} {всего} {баллы}' },
      { key: 'streak_bonus', ru: '{дней} дней подряд — +{бонус} баллов.', kg: '{дней} күн катары менен — +{бонус} балл.', ph: '{дней} {бонус}' },
      { key: 'paused', ru: 'Пауза включена до {дата}. Напоминания не приходят, баллы не снимаются.', kg: 'Пауза {дата} чейин күйгүзүлдү. Эскертүүлөр келбейт, балл алынбайт.', ph: '{дата}' },
      { key: 'two_marathons_prefix', ru: '[{марафон}] ', kg: '[{марафон}] ', ph: '{марафон}' },
      { key: 'help', ru: '/otchet — что можно сдать сейчас · /ball — мои баллы · /zona — место и время · /marafon — сменить марафон · /pauza — пауза · /tahajjud — напоминания о Тахаджуде · /til — язык', kg: '/otchet — азыр эмне тапшырса болот · /ball — менин баллдарым · /zona — жер жана убакыт · /marafon — марафон алмаштыруу · /pauza — пауза · /tahajjud — Тахажуд эскертүүлөрү · /til — тил', ph: '' },
    ],
    bot: {
      username: 'janykadam_bot',
      name: 'Janykadam · марафондор',
      desc: 'Жаңы Кадам жамаатынын марафон боту. Күн сайын видеокружок менен отчёт тапшырып, рухий тартипти бекемдеңиз.',
      shortDesc: 'Марафондор боту Janykadam',
      commands: '/otchet — что можно сдать сейчас\n/ball — мои баллы\n/zona — место и время\n/marafon — сменить марафон\n/pauza — пауза\n/tahajjud — напоминания о Тахаджуде\n/til — язык\n/help — помощь',
      menu: ['🎥 Отчёт тапшыруу', '✅ Отчётторум', '🤲 Максаттарым', '😎 Өзүм жөнүндө', '🕐 Убакыт алкагы', '❓ Жардам'],
      quietFrom: '22:30',
      quietTo: '04:30',
      capPerDay: 6,
    },
    botDraft: null,
    edit: null,
    topicId: null,
    topicTab: 'settings',
    qId: null,
    pvLang: 'kg',
    pvDone: false,
    tzView: 'Asia/Bishkek',
    pf: { q: '', status: 'all', tz: 'all', act: 'all', sort: 'name', dir: 1, sel: [] },
    drawerId: null,
    pointsModal: null,
    confirm: null,
    toast: null,
    textQ: '',
    textUntr: false,
    textKey: 'start_welcome',
    bc: {
      text: 'Ассаляму алейкум, {имя}! «{марафон}» уланууда — бүгүн да видеокружок унутпаңыз. Сиздин баллыңыз: {баллы}.',
      seg: 'all', when: 'now', stage: 'compose', sent: 0, result: null,
    },
    newM: null,
    filterTab: 'all',
    invite: null,
    userQ: '',
  };
}
