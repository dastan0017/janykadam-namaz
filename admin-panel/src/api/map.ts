import { NAMAZ } from '../data/constants';
import { localDate } from '../lib/time';
import type {
  AnswerOption, AuditEntry, Broadcast, BotSettings, BotText, LedgerEntry, Marathon, Me, PanelUser,
  Participant, Question, Topic, ValidationIssue,
} from '../types';
import type {
  AdminUserDto, AuditEntryDto, BotSettingsDto, BotTextDto, BroadcastDto, LedgerEntryDto, MarathonDto, MeDto,
  NamazDto, OptionDto, ParticipantRowDto, PrayerPresetDto, PrayerTimesDto, QuestionDto, TopicDto,
  ValidationIssueDto,
} from './dto';

/**
 * Перевод между ответами API и моделью панели.
 *
 * Единственное место, где встречаются два набора имён: у бота `startDate` и
 * `excusedDays`, у панели `start` и `excused`. Экраны знают только модель панели,
 * поэтому дизайн и расчёты остались как были.
 */

/** Не сдавала ни разу: в таблице это «молчит» сильнее трёх дней. */
export const NEVER_REPORTED = 99;

/* ───────── вход ───────── */

export function toMe(dto: MeDto): Me {
  return { id: dto.id, name: dto.name, tg: dto.tgUsername ? `@${dto.tgUsername}` : '', role: dto.role };
}

/* ───────── марафон ───────── */

export function toMarathon(dto: MarathonDto): Marathon {
  return {
    id: dto.id,
    code: dto.code,
    name: dto.name,
    status: dto.status,
    start: dto.startDate,
    end: dto.endDate,
    lang: dto.defaultLang,
    regOpen: dto.regOpen,
    pointsDefault: dto.pointsDefault,
    streakBonus: dto.streakBonus,
    streakEvery: dto.streakEvery,
    latePasses: dto.latePasses,
    excused: dto.excusedDays,
    pauseAllowed: dto.pauseAllowed,
    remindMorning: (dto.remindMorning ?? '').slice(0, 5),
    remindEvening: (dto.remindEvening ?? '').slice(0, 5),
    skipSubmitted: dto.skipSubmitted,
    reported: dto.stats?.total,
    stats: dto.stats && {
      total: dto.stats.total,
      active: dto.stats.active,
      submittedToday: dto.stats.submittedToday,
      pct: dto.stats.pct,
    },
    namazCount: dto.namazIds?.length,
    topicsCount: dto.topicsCount,
  };
}

/** Поля марафона в имена бэкенда — для PATCH. */
const MARATHON_FIELD: Record<string, string> = {
  code: 'code',
  name: 'name',
  status: 'status',
  start: 'startDate',
  end: 'endDate',
  lang: 'defaultLang',
  regOpen: 'regOpen',
  pointsDefault: 'pointsDefault',
  streakBonus: 'streakBonus',
  streakEvery: 'streakEvery',
  latePasses: 'latePasses',
  excused: 'excusedDays',
  pauseAllowed: 'pauseAllowed',
  remindMorning: 'remindMorning',
  remindEvening: 'remindEvening',
  skipSubmitted: 'skipSubmitted',
};

/** `{ excused: 3 }` → `{ excusedDays: 3 }`. Поля без пары на бэкенде отбрасываются. */
export function marathonPatch(key: string, value: unknown): Record<string, unknown> | null {
  const field = MARATHON_FIELD[key];
  if (!field) return null;
  // Пустое время напоминания означает «не слать», то есть NULL в базе.
  if ((field === 'remindMorning' || field === 'remindEvening') && !value) return { [field]: null };
  return { [field]: value };
}

/* ───────── темы, вопросы, варианты ───────── */

export function toOption(dto: OptionDto): AnswerOption {
  return { id: dto.id, kg: dto.labelKg, ru: dto.labelRu, pts: dto.points, locked: dto.locked || undefined };
}

export function toQuestion(dto: QuestionDto): Question {
  return {
    id: dto.id,
    textKg: dto.textKg,
    textRu: dto.textRu,
    type: dto.type,
    required: dto.required,
    options: dto.options.map(toOption),
  };
}

export function toTopic(dto: TopicDto): Topic {
  return {
    id: dto.id,
    emoji: dto.emoji,
    nameKg: dto.nameKg,
    nameRu: dto.nameRu,
    active: dto.active,
    mode: 'fixed',
    start: dto.startLocal.slice(0, 5),
    end: dto.endLocal.slice(0, 5),
    points: dto.points,
    freq: dto.freq,
    mandatory: dto.mandatory,
    remind: dto.remindOffsetMin,
    questions: dto.questions.map(toQuestion),
  };
}

const TOPIC_FIELD: Record<string, string> = {
  emoji: 'emoji',
  nameKg: 'nameKg',
  nameRu: 'nameRu',
  active: 'active',
  start: 'startLocal',
  end: 'endLocal',
  points: 'points',
  freq: 'freq',
  mandatory: 'mandatory',
  remind: 'remindOffsetMin',
};

/** Правка своей темы в тело PATCH. `null` — поле не сохраняется (черновик пустых баллов). */
export function topicPatch(key: string, value: unknown): Record<string, unknown> | null {
  const field = TOPIC_FIELD[key];
  if (!field) return null;
  if (field === 'points') {
    // Пустая строка в редакторе — незаполненное поле, на бэкенд её не отправляем.
    if (value === '' || value === null) return null;
    return { points: Number(value) };
  }
  if (field === 'startLocal' || field === 'endLocal') {
    const s = String(value ?? '');
    return /^\d{2}:\d{2}$/.test(s) ? { [field]: s } : null;
  }
  return { [field]: value };
}

const QUESTION_FIELD: Record<string, string> = {
  textKg: 'textKg',
  textRu: 'textRu',
  type: 'type',
  required: 'required',
};

export function questionPatch(key: string, value: unknown): Record<string, unknown> | null {
  const field = QUESTION_FIELD[key];
  return field ? { [field]: value } : null;
}

/** Поля настроек бота в имена бэкенда. */
const BOT_FIELD: Record<string, string> = {
  desc: 'description',
  shortDesc: 'shortDescription',
  commands: 'commands',
  quietFrom: 'quietFrom',
  quietTo: 'quietTo',
  capPerDay: 'capPerDay',
};

export function botPatch(key: string, value: unknown): Record<string, unknown> | null {
  const field = BOT_FIELD[key];
  if (!field) return null;
  // Команды хранятся парами, а правятся одним текстовым полем.
  if (field === 'commands') return { commands: parseCommands(String(value)) };
  return { [field]: value };
}

export function optionPatch(key: 'kg' | 'ru' | 'pts', value: string | number): Record<string, unknown> {
  if (key === 'kg') return { labelKg: String(value) };
  if (key === 'ru') return { labelRu: String(value) };
  return { points: Number(value) || 0 };
}

/** Библиотека намазов: имена, баллы и правило берём с бэкенда, окна остаются в коде панели. */
export function applyNamazLibrary(rows: NamazDto[]): void {
  for (const row of rows) {
    const local = NAMAZ.find((n) => n.id === row.id);
    if (!local) continue;
    local.emoji = row.emoji;
    local.nameKg = row.nameKg;
    local.nameRu = row.nameRu;
    local.rule = row.ruleRu || row.ruleKg;
    local.points = row.points;
    local.mandatory = row.mandatory;
  }
}

/* ───────── участницы ───────── */

export function toParticipant(dto: ParticipantRowDto): Participant {
  const tz = dto.tz ?? '';
  return {
    id: dto.participantId,
    // Имён вроде «Нургүл» в марафоне десяток — фамилия нужна, чтобы различать.
    name: [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim() || dto.firstName,
    user: dto.username ? `@${dto.username}` : '',
    tz,
    place: dto.placeLabel ?? '',
    status: dto.status,
    points: dto.points,
    streak: dto.streak,
    last: dto.daysSinceReport ?? NEVER_REPORTED,
    today: dto.todayTopicIds,
    lang: dto.lang,
    blocked: dto.blocked,
    joined: localDate(tz || 'Asia/Bishkek', new Date(dto.joinedAt)),
    d7: dto.reachedDay7,
    goal: dto.goal ?? '',
  };
}

export function toLedger(dto: LedgerEntryDto): LedgerEntry {
  return { d: dto.createdAt.slice(0, 10), delta: dto.delta, reason: dto.reason };
}

/* ───────── рассылки ───────── */

/** Сегменты панели и сегменты бэкенда — одно и то же, но названы иначе. */
export function toSegmentDto(seg: string, selIds: string[] = []): unknown {
  if (seg === 'all') return { kind: 'all_active' };
  if (seg === 'nottoday') return { kind: 'not_today' };
  if (seg === 'stopped') return { kind: 'silent_3d' };
  if (seg === 'paused') return { kind: 'paused' };
  if (seg === 'new') return { kind: 'new_today' };
  if (seg === 'selected') return { kind: 'selected', participantIds: selIds };
  if (seg.startsWith('tz_')) return { kind: 'tz', tz: seg.slice(3) };
  return { kind: 'all_active' };
}

const SEGMENT_LABEL: Record<string, string> = {
  all_active: 'Все активные',
  not_today: 'Не сдали сегодня',
  silent_3d: 'Молчат 3+ дня',
  paused: 'На паузе',
  new_today: 'Новые сегодня',
  selected: 'Выбранные в таблице',
};

export function toBroadcast(dto: BroadcastDto): Broadcast {
  const kind = String((dto.segment as { kind?: string }).kind ?? '');
  const tz = String((dto.segment as { tz?: string }).tz ?? '');
  return {
    id: dto.id,
    at: dto.createdAt.slice(0, 10),
    text: dto.text,
    seg: kind === 'tz' ? `Пояс ${tz}` : (SEGMENT_LABEL[kind] ?? kind),
    count: dto.totals.count ?? 0,
    delivered: dto.totals.sent ?? 0,
    blocked: (dto.totals.blocked ?? 0) + (dto.totals.failed ?? 0),
  };
}

/* ───────── бот, тексты, пользователи, журнал ───────── */

export function toBotSettings(dto: BotSettingsDto, username: string, name: string): BotSettings {
  return {
    username,
    name,
    desc: dto.description,
    shortDesc: dto.shortDescription,
    commands: dto.commands.map((c) => `/${c.command} — ${c.description}`).join('\n'),
    menu: dto.menu,
    quietFrom: dto.quietFrom.slice(0, 5),
    quietTo: dto.quietTo.slice(0, 5),
    capPerDay: dto.capPerDay,
  };
}

/** «/otchet — сдать отчёт» в пару `{ command, description }`. */
export function parseCommands(text: string): { command: string; description: string }[] {
  return text
    .split('\n')
    .map((line) => /^\s*\/?([a-z0-9_]{1,32})\s*[—–-]?\s*(.*)$/i.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ command: m[1].toLowerCase(), description: m[2].trim() }));
}

export function toBotText(dto: BotTextDto): BotText {
  return { key: dto.key, ru: dto.ru, kg: dto.kg, ph: dto.placeholders.join(' ') };
}

export function toPanelUser(dto: AdminUserDto): PanelUser {
  return {
    id: dto.id,
    name: dto.name,
    tg: `@${dto.tgUsername}`,
    role: dto.role,
    last: dto.lastLoginAt ? dto.lastLoginAt.slice(0, 10) : '',
    invited: dto.status === 'invited' || undefined,
  };
}

const ACTION_LABEL: Record<string, string> = {
  create: 'Создала',
  update: 'Изменила',
  delete: 'Удалила',
  duplicate: 'Дублировала',
  launch: 'Запустила',
  set_namaz: 'Изменила состав намазов',
  set_status: 'Изменила статус',
  adjust_points: 'Изменила баллы',
  excuse_day: 'Отметила уважительный день',
  remove: 'Исключила',
  set_role: 'Изменила роль',
  disable: 'Отключила доступ',
  set_name: 'Изменила имя бота',
  login: 'Вошла в панель',
};

/** Действия, у которых сущность в подписи не нужна. */
const NO_ENTITY = new Set(['login']);

const ENTITY_LABEL: Record<string, string> = {
  marathon: 'марафон',
  topic: 'тему',
  question: 'вопрос',
  enrollment: 'участницу',
  broadcast: 'рассылку',
  admin_user: 'пользователя панели',
  bot_settings: 'настройки бота',
  bot_text: 'текст бота',
  bot: 'бота',
};

export function toAuditEntry(dto: AuditEntryDto): AuditEntry {
  const action = ACTION_LABEL[dto.action] ?? dto.action;
  const entity = ENTITY_LABEL[dto.entity] ?? dto.entity;
  const details = dto.details && Object.keys(dto.details).length ? ` · ${JSON.stringify(dto.details)}` : '';
  return {
    at: dto.createdAt.replace('T', ' ').slice(0, 16),
    who: dto.actorLabel || '—',
    what: NO_ENTITY.has(dto.action) ? action : `${action}: ${entity}${details}`,
  };
}

/* ───────── проверка конфигурации ───────── */

const ISSUE_SCREEN: Record<string, ValidationIssue['screen']> = {
  topic: 'topicEditor',
  question: 'questionEditor',
  option: 'questionEditor',
  marathon: 'settings',
  texts: 'texts',
};

export function toValidationIssue(dto: ValidationIssueDto): ValidationIssue {
  const kind = dto.entity?.kind;
  return {
    level: dto.level,
    text: dto.message,
    screen: (kind && ISSUE_SCREEN[kind]) ?? 'topics',
    extra: kind === 'topic' && dto.entity?.id ? { topicId: dto.entity.id, topicTab: 'settings' } : undefined,
  };
}

/* ───────── время намазов ───────── */

/** Моменты UTC из API в минуты от местной полуночи — в них считает панель. */
export function toPresetTimes(dto: PrayerPresetDto): { tz: string; city: string; pt: Record<string, number> } {
  const pt: Record<string, number> = {};
  for (const [name, iso] of Object.entries(dto.times as PrayerTimesDto)) {
    pt[name] = minutesInZone(iso, dto.tz);
  }
  return { tz: dto.tz, city: dto.label, pt };
}

function minutesInZone(iso: string, tz: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}
