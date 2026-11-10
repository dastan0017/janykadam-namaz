/**
 * Ответы админ-API бота, как они приходят по сети.
 *
 * Это не доменная модель панели: имена полей здесь такие же, как в базе бота
 * (`startDate`, а не `start`), а времена — строки ISO. Перевод в модель панели
 * живёт в `map.ts`, и только там; экраны про DTO не знают.
 */

export type Lang = 'kg' | 'ru';
export type Role = 'admin' | 'curator';
export type MarathonStatusDto = 'draft' | 'recruiting' | 'running' | 'finished' | 'archive';
export type EnrollmentStatusDto = 'active' | 'paused' | 'left' | 'finished';
export type QuestionTypeDto = 'single' | 'multi' | 'text' | 'number' | 'scale' | 'yesno';
export type FreqDto = 'daily' | 'weekly';

export interface MeDto {
  id: string;
  name: string;
  tgUsername: string;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
}

export interface MarathonStatsDto {
  total: number;
  active: number;
  submittedToday: number;
  pct: number;
  reportsToday: number;
  newToday: number;
  newTodaySubmitted: number;
}

export interface MarathonDto {
  id: string;
  code: string;
  name: string;
  status: MarathonStatusDto;
  startDate: string;
  endDate: string;
  defaultLang: Lang;
  regOpen: boolean;
  pointsDefault: number;
  streakBonus: number;
  streakEvery: number;
  latePasses: number;
  excusedDays: number;
  pauseAllowed: boolean;
  remindMorning: string | null;
  remindEvening: string | null;
  skipSubmitted: boolean;
  createdAt: string;
  /** Включённые намазы, в порядке библиотеки. */
  namazIds?: string[];
  /** Сколько своих тем — для карточки в списке марафонов. */
  topicsCount?: number;
  stats?: MarathonStatsDto;
}

export interface OverviewDto extends MarathonStatsDto {
  activeCount: number;
  byTopic: { topicId: string; n: number }[];
  trend: { dayKey: string; n: number }[];
}

export interface OptionDto {
  id: string;
  questionId: string;
  position: number;
  labelKg: string;
  labelRu: string;
  points: number;
  locked: boolean;
}

export interface QuestionDto {
  id: string;
  topicId: string | null;
  namazId: string | null;
  position: number;
  textKg: string;
  textRu: string;
  type: QuestionTypeDto;
  required: boolean;
  options: OptionDto[];
}

export interface TopicDto {
  id: string;
  marathonId: string;
  position: number;
  emoji: string;
  nameKg: string;
  nameRu: string;
  active: boolean;
  startLocal: string;
  endLocal: string;
  points: number;
  freq: FreqDto;
  mandatory: boolean;
  remindOffsetMin: number;
  questions: QuestionDto[];
}

export interface NamazDto {
  id: string;
  position: number;
  emoji: string;
  nameKg: string;
  nameRu: string;
  ruleKg: string;
  ruleRu: string;
  points: number;
  mandatory: boolean;
  optIn: boolean;
}

export interface ParticipantRowDto {
  participantId: string;
  firstName: string;
  lastName: string;
  username: string | null;
  tz: string | null;
  /** Как называется её место: Бишкек и Ош в одной зоне, но времена разные. */
  placeLabel: string | null;
  lang: Lang;
  blocked: boolean;
  lastSeenAt: string | null;
  enrollmentId: string;
  status: EnrollmentStatusDto;
  points: number;
  streak: number;
  bestStreak: number;
  joinedAt: string;
  /** Темы, сданные сегодня по её местной дате. */
  todayTopicIds: string[];
  /** 0 — сдала сегодня, null — не сдавала ни разу. */
  daysSinceReport: number | null;
  reachedDay7: boolean;
  /** Зачем пришла в марафон — её слова, спрошенные при записи. */
  goal: string | null;
}

export interface LedgerEntryDto {
  id: string;
  enrollmentId: string;
  delta: number;
  reason: string;
  createdAt: string;
}

export interface ParticipantDetailDto {
  participant: {
    id: string;
    tgUserId: string;
    firstName: string;
    username: string | null;
    lang: Lang;
    tz: string | null;
    placeLabel: string | null;
    blocked: boolean;
    tahajjudReminders: boolean;
    createdAt: string;
    lastSeenAt: string;
  };
  localNow: string;
  enrollments: { enrollment: { id: string; status: EnrollmentStatusDto; points: number; streak: number; bestStreak: number; latePassesUsed: number; joinedAt: string }; marathon: MarathonDto }[];
  todayWindows: { topicId: string; name: string; opensAt: string; closesAt: string; done: boolean; uzur: boolean }[];
  last7: { dayKey: string; topicId: string; points: number }[];
  ledger: LedgerEntryDto[];
}

export interface BroadcastDto {
  id: string;
  marathonId: string;
  text: string;
  segment: Record<string, unknown>;
  schedule: Record<string, unknown>;
  status: 'draft' | 'scheduled' | 'sending' | 'done' | 'failed';
  totals: Record<string, number>;
  createdBy: string | null;
  createdAt: string;
}

export interface BroadcastProgressDto {
  status: string;
  totals: Record<string, number>;
}

export interface AnalyticsDto {
  byTopic: { topicId: string; n: number }[];
  byTz: { tz: string; total: number; done: number }[];
  funnel: { registered: number; firstReport: number; activeToday: number };
  dropoff: number;
}

export type PrayerName = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export type PrayerTimesDto = Record<PrayerName, string>;

export interface PrayerPresetDto {
  label: string;
  tz: string;
  times: PrayerTimesDto;
}

export interface BotSettingsDto {
  /** Имя и username бота приходят из Telegram, а не из базы. */
  username: string;
  name: string;
  quietFrom: string;
  quietTo: string;
  capPerDay: number;
  menu: string[];
  commands: { command: string; description: string }[];
  description: string;
  shortDescription: string;
  prayerTune: Record<PrayerName, number>;
  methodVersion: string;
}

export interface BotTextDto {
  key: string;
  ru: string;
  kg: string;
  placeholders: string[];
}

export interface AdminUserDto {
  id: string;
  name: string;
  tgUsername: string;
  tgUserId: string | null;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditEntryDto {
  id: string;
  actorAdminId: string | null;
  actorLabel: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface ValidationIssueDto {
  level: 'error' | 'warn';
  code: string;
  message: string;
  /** Где чинить — панель переводит это в экран и подсветку. */
  entity?: { kind: 'topic' | 'question' | 'option' | 'marathon' | 'texts'; id?: string };
}

export interface ValidationDto {
  issues: ValidationIssueDto[];
  blocked: boolean;
}

/** Данные, которые отдаёт виджет входа Telegram. */
export interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}
