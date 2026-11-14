import { FALLBACK_TZ, NAMAZ, TZ, TZ_ORDER } from '../data/constants';
import type { AnyTopic, AppState, Marathon, MarathonData, Participant, Segment, Topic, ValidationIssue } from '../types';
import { plural } from './format';
import { localDate, nsTopic, toMin } from './time';

/** Вошла сегодня — по её местной дате, а не по дате сервера. */
export function isNewToday(p: Participant): boolean {
  return !!p.joined && p.joined === localDate(p.tz || FALLBACK_TZ);
}

const EMPTY_DATA: MarathonData = { topics: [], namaz: [], participants: [], trend: [], ledger: {}, recent: {}, broadcasts: [] };

export function currentMarathon(s: AppState): Marathon | undefined {
  return s.marathons.find((m) => m.id === s.mid) ?? s.marathons[0];
}

export function currentData(s: AppState): MarathonData {
  return (s.mid ? s.data[s.mid] : undefined) ?? EMPTY_DATA;
}

/** Все темы бота в порядке показа: сначала включённые намазы, потом свои темы. */
export function allTopics(s: AppState): AnyTopic[] {
  const d = currentData(s);
  const sel = d.namaz ?? [];
  const namaz = NAMAZ.filter((n) => sel.includes(n.id)).map(nsTopic);
  return [...namaz, ...d.topics];
}

export function activeTopics(s: AppState): AnyTopic[] {
  return allTopics(s).filter((t) => t.active);
}

export function currentTopic(s: AppState): Topic | undefined {
  return currentData(s).topics.find((t) => t.id === s.topicId);
}

export function currentQuestion(s: AppState) {
  return currentTopic(s)?.questions.find((q) => q.id === s.qId);
}

/** Сдала ли она сегодня хотя бы по одной включённой теме. */
export function doneToday(s: AppState, p: Participant): boolean {
  const act = new Set(activeTopics(s).map((t) => t.id));
  return p.today.some((id) => act.has(id));
}

export interface Stats {
  total: number;
  active: number;
  done: number;
  pct: number;
  stopped: number;
  reports: number;
  paused: number;
  newToday: number;
  newStarted: number;
}

export function stats(s: AppState): Stats {
  const ps = currentData(s).participants;
  const act = ps.filter((p) => p.status === 'active');
  const done = act.filter((p) => doneToday(s, p)).length;
  const actIds = new Set(activeTopics(s).map((t) => t.id));
  const reports = act.reduce((n, p) => n + p.today.filter((id) => actIds.has(id)).length, 0);
  const fresh = ps.filter(isNewToday);
  return {
    total: ps.length,
    active: act.length,
    done,
    pct: act.length ? Math.round((done / act.length) * 100) : 0,
    stopped: act.filter((p) => p.last >= 3).length,
    reports,
    paused: ps.filter((p) => p.status === 'paused').length,
    newToday: fresh.length,
    newStarted: fresh.filter((p) => p.today.length).length,
  };
}

/**
 * Проверка конфигурации — пересчитывается на каждом изменении.
 * Ошибки блокируют запуск марафона, предупреждения — нет.
 */
export function validate(s: AppState): ValidationIssue[] {
  const m = currentMarathon(s);
  const d = currentData(s);
  const out: ValidationIssue[] = [];
  const E = (text: string, screen: ValidationIssue['screen'], extra?: ValidationIssue['extra']) => out.push({ level: 'error', text, screen, extra });
  const W = (text: string, screen: ValidationIssue['screen'], extra?: ValidationIssue['extra']) => out.push({ level: 'warn', text, screen, extra });

  if (!(d.namaz ?? []).length && !d.topics.length) {
    E('В марафоне нет ни одной темы — участнице нечего сдавать', 'topics');
  }

  d.topics.filter((t) => t.active).forEach((t) => {
    const at = { topicId: t.id, topicTab: 'settings' as const };
    if (!t.nameKg) E('Тема без названия на кыргызском', 'topicEditor', at);
    if (!t.nameRu) W(`Тема «${t.nameKg}»: нет русского названия`, 'topicEditor', at);
    if (t.points === '' || Number(t.points) < 0) E(`Тема «${t.nameKg}»: баллы не заданы`, 'topicEditor', at);
    if (toMin(t.end) <= toMin(t.start)) E(`Тема «${t.nameKg}»: окно закрывается раньше, чем открывается`, 'topicEditor', at);

    t.questions.forEach((q, i) => {
      const aq = { topicId: t.id, qId: q.id };
      if ((q.type === 'single' || q.type === 'multi') && q.options.length < 2) E(`«${t.nameKg}», вопрос ${i + 1}: вариантов ответа меньше двух`, 'questionEditor', aq);
      if (q.options.length > 8) W(`«${t.nameKg}», вопрос ${i + 1}: ${q.options.length} кнопок — клавиатура станет стеной`, 'questionEditor', aq);
      if (!q.textRu || !q.textKg) W(`«${t.nameKg}», вопрос ${i + 1}: нет перевода ${!q.textKg ? 'на кыргызский' : 'на русский'}`, 'questionEditor', aq);
      if (q.options.some((o) => !o.kg || !o.ru)) W(`«${t.nameKg}», вопрос ${i + 1}: вариант без перевода`, 'questionEditor', aq);
      if (!q.textKg && !q.textRu) E(`«${t.nameKg}», вопрос ${i + 1}: пустой текст`, 'questionEditor', aq);
    });
  });

  // Пересечение окон — не ошибка: «Зикир» на весь день идёт поверх намазов,
  // а отчёт участница сдаёт по каждой теме отдельно, кнопкой с её id.

  // Лимит меньше числа тем — часть напоминаний молча не придёт.
  // Тахажуд не в счёт: о нём напоминают только по согласию.
  const cap = s.bot.capPerDay;
  const reminded = activeTopics(s).filter((t) => t.id !== 't1').length;
  if (cap > 0 && reminded > cap) {
    W(`Тем с напоминаниями ${reminded}, а лимит в день — ${cap}: о ${reminded - cap} ${plural(reminded - cap, 'теме', 'темах', 'темах')} не напомнят`, 'bot');
  }

  // Канал отчётов обязателен — те же правила, что у бэкенда перед запуском.
  if (m && m.status !== 'finished' && m.status !== 'archive') {
    const ch = m.channel;
    if (!ch.link) E('Нет ссылки на канал отчётов', 'channel');
    else if (!ch.chatId) E('Канал отчётов не подключён: добавьте бота в канал админом', 'channel');
    else if (!ch.ready) E('У бота в канале не хватает прав: нужно публиковать и приглашать', 'channel');
    else {
      if (!ch.isPrivate) W('Канал отчётов публичный: видео участниц может увидеть кто угодно', 'channel');
      if (!ch.protectedContent) W('В канале не запрещено копирование: видео можно сохранить и переслать', 'channel');
      if (!ch.rights.restrict) W('Бот не может удалять из канала: исключённые из марафона останутся в нём', 'channel');
    }
  }

  if (m) {
    if (m.status === 'draft' && m.start < localDate(FALLBACK_TZ)) E(`Дата начала ${m.start} уже прошла`, 'settings');
    if (m.end < m.start) E('Дата окончания раньше начала', 'settings');
  }

  // Предупреждение открывает тот самый текст — фильтр и поиск сбрасываются,
  // иначе строки может не оказаться в списке.
  s.texts
    .filter((t) => !t.kg || !t.ru)
    .forEach((t) => W(`Текст бота «${t.key}» не переведён`, 'texts', { textKey: t.key, textQ: '', textUntr: false }));
  return out;
}

export function filteredParts(s: AppState): Participant[] {
  const f = s.pf;
  const q = f.q.trim().toLowerCase();
  const ps = currentData(s).participants.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q) && !p.user.includes(q)) return false;
    if (f.status !== 'all' && p.status !== f.status) return false;
    if (f.tz !== 'all' && p.tz !== f.tz) return false;
    if (f.act === 'today') return doneToday(s, p);
    if (f.act === 'nottoday') return p.status === 'active' && !doneToday(s, p);
    if (f.act === 'stopped') return p.status === 'active' && p.last >= 3;
    if (f.act === 'new') return isNewToday(p);
    return true;
  });

  return [...ps].sort((a, b) => {
    const k = f.sort;
    const va = k === 'tz' ? TZ[a.tz]?.city ?? '' : a[k];
    const vb = k === 'tz' ? TZ[b.tz]?.city ?? '' : b[k];
    return (va > vb ? 1 : va < vb ? -1 : 0) * f.dir;
  });
}

/** Сегменты рассылки — число получателей считается по текущим данным участниц. */
export function segments(s: AppState): Segment[] {
  const ps = currentData(s).participants;
  const act = ps.filter((p) => p.status === 'active');
  const sel = s.bc.selIds ?? [];

  const segs: Segment[] = [
    { id: 'all', name: 'Все активные', list: act },
    { id: 'nottoday', name: 'Не сдали сегодня', list: act.filter((p) => !doneToday(s, p)) },
    { id: 'stopped', name: 'Молчат 3+ дня', list: act.filter((p) => p.last >= 3) },
    { id: 'paused', name: 'На паузе', list: ps.filter((p) => p.status === 'paused') },
    ...TZ_ORDER
      .map((k) => ({ id: 'tz_' + k, name: 'Пояс ' + (TZ[k]?.city ?? k) + ' · ' + (TZ[k]?.utc ?? ''), list: act.filter((p) => p.tz === k) }))
      .filter((x) => x.list.length),
  ];

  if (sel.length) segs.unshift({ id: 'selected', name: 'Выбранные в таблице', list: ps.filter((p) => sel.includes(p.id)) });
  return segs;
}

/** Подстановка плейсхолдеров рассылки под конкретную участницу. */
export function fillPlaceholders(text: string, p: Participant, marathonName: string): string {
  return (text || '')
    .replace(/\{имя\}/g, p.name.split(' ')[0])
    .replace(/\{баллы\}/g, String(p.points))
    .replace(/\{марафон\}/g, marathonName);
}

export function issueSummary(errs: number, warns: number): string {
  if (errs) {
    const head = `${errs} ${plural(errs, 'ошибка', 'ошибки', 'ошибок')} ${plural(errs, 'блокирует', 'блокируют', 'блокируют')} запуск`;
    return warns ? `${head}, ${warns} ${plural(warns, 'предупреждение', 'предупреждения', 'предупреждений')}` : head;
  }
  if (warns) return `Ошибок нет, ${warns} ${plural(warns, 'предупреждение', 'предупреждения', 'предупреждений')}`;
  return 'Конфигурация в порядке';
}

export const isCurator = (s: AppState) => s.role === 'curator';
export const meId = (s: AppState) => s.me?.id ?? '';
export const meName = (s: AppState) => s.me?.name ?? '';
