import { relations, sql } from 'drizzle-orm';
import {
  boolean, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, smallint,
  text, time, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

/**
 * Схема БД. Все моменты времени — timestamptz в UTC; локальные календарные даты
 * и «часы:минуты» хранятся как date/time без зоны и всегда трактуются в зоне участницы.
 *
 * Нет команд, капитанов, кодов команд, модерации и типов отчёта кроме видеокружка —
 * этих сущностей в системе не существует.
 */

/* ───────────────── перечисления ───────────────── */

export const adminRole = pgEnum('admin_role', ['admin', 'curator']);
export const adminStatus = pgEnum('admin_status', ['invited', 'active', 'disabled']);
export const marathonStatus = pgEnum('marathon_status', ['draft', 'recruiting', 'running', 'finished', 'archive']);
export const langEnum = pgEnum('lang', ['kg', 'ru']);
export const topicFreq = pgEnum('topic_freq', ['daily', 'weekly']);
export const questionType = pgEnum('question_type', ['single', 'multi', 'text', 'number', 'scale', 'yesno']);
export const enrollmentStatus = pgEnum('enrollment_status', ['active', 'paused', 'left', 'finished']);
export const topicKind = pgEnum('topic_kind', ['namaz', 'custom']);
export const locationSource = pgEnum('location_source', ['preset', 'search', 'geo']);
export const deliveryStatus = pgEnum('delivery_status', ['pending', 'sent', 'blocked', 'failed']);
export const broadcastStatus = pgEnum('broadcast_status', ['draft', 'scheduled', 'sending', 'done', 'failed']);
/** Чей день и что он снимает: куратор освобождает от всего, узур — только от намазов. */
export const excusedScope = pgEnum('excused_scope', ['day', 'namaz']);

/* ───────────────── доступ в панель ───────────────── */

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    tgUsername: text('tg_username').notNull(),
    tgUserId: text('tg_user_id'),
    role: adminRole('role').notNull().default('curator'),
    status: adminStatus('status').notNull().default('invited'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // username сравнивается без учёта регистра — Telegram его не различает
    uniqueIndex('admin_users_tg_username_key').on(sql`lower(${t.tgUsername})`),
    uniqueIndex('admin_users_tg_user_id_key').on(t.tgUserId),
  ],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminUserId: uuid('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('admin_sessions_token_key').on(t.tokenHash), index('admin_sessions_user_idx').on(t.adminUserId)],
);

/* ───────────────── марафоны и темы ───────────────── */

export const marathons = pgTable(
  'marathons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: marathonStatus('status').notNull().default('draft'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    defaultLang: langEnum('default_lang').notNull().default('kg'),
    regOpen: boolean('reg_open').notNull().default(false),
    pointsDefault: integer('points_default').notNull().default(10),
    streakBonus: integer('streak_bonus').notNull().default(5),
    streakEvery: integer('streak_every').notNull().default(7),
    latePasses: integer('late_passes').notNull().default(2),
    excusedDays: integer('excused_days').notNull().default(3),
    /** Свои правила марафона; пусто — действуют общие из текстов бота. */
    rulesKg: text('rules_kg'),
    rulesRu: text('rules_ru'),
    pauseAllowed: boolean('pause_allowed').notNull().default(true),
    remindMorning: time('remind_morning'),
    remindEvening: time('remind_evening'),
    skipSubmitted: boolean('skip_submitted').notNull().default(true),
    /** Ссылка на канал отчётов, как её вставил админ. Без неё марафон не создать. */
    channelLink: text('channel_link'),
    /** Канал, где бот уже админ. Пока бота туда не добавили — пусто. */
    channelChatId: text('channel_chat_id'),
    channelTitle: text('channel_title'),
    /** Ссылка с заявкой на вступление: её получают участницы, заявки одобряет бот. */
    channelInviteLink: text('channel_invite_link'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('marathons_code_key').on(t.code),
    // Один канал — один марафон: иначе отчёты двух марафонов смешаются.
    uniqueIndex('marathons_channel_chat_key').on(t.channelChatId),
  ],
);

/** Зеркало кодовых констант. Только чтение: API для правки нет. */
export const namazTopics = pgTable('namaz_topics', {
  id: text('id').primaryKey(),
  position: smallint('position').notNull(),
  emoji: text('emoji').notNull(),
  nameKg: text('name_kg').notNull(),
  nameRu: text('name_ru').notNull(),
  ruleKg: text('rule_kg').notNull(),
  ruleRu: text('rule_ru').notNull(),
  points: integer('points').notNull(),
  mandatory: boolean('mandatory').notNull(),
  optIn: boolean('opt_in').notNull().default(false),
});

export const marathonNamaz = pgTable(
  'marathon_namaz',
  {
    marathonId: uuid('marathon_id').notNull().references(() => marathons.id, { onDelete: 'cascade' }),
    namazId: text('namaz_id').notNull().references(() => namazTopics.id),
  },
  (t) => [primaryKey({ columns: [t.marathonId, t.namazId] })],
);

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marathonId: uuid('marathon_id').notNull().references(() => marathons.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    emoji: text('emoji').notNull().default('🕊'),
    nameKg: text('name_kg').notNull().default(''),
    nameRu: text('name_ru').notNull().default(''),
    active: boolean('active').notNull().default(true),
    startLocal: time('start_local').notNull().default('05:00'),
    endLocal: time('end_local').notNull().default('22:00'),
    points: integer('points').notNull().default(10),
    freq: topicFreq('freq').notNull().default('daily'),
    mandatory: boolean('mandatory').notNull().default(false),
    remindOffsetMin: integer('remind_offset_min').notNull().default(0),
  },
  (t) => [index('topics_marathon_idx').on(t.marathonId, t.position)],
);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    namazId: text('namaz_id').references(() => namazTopics.id),
    position: integer('position').notNull().default(0),
    textKg: text('text_kg').notNull().default(''),
    textRu: text('text_ru').notNull().default(''),
    type: questionType('type').notNull().default('single'),
    required: boolean('required').notNull().default(true),
  },
  (t) => [index('questions_topic_idx').on(t.topicId, t.position), index('questions_namaz_idx').on(t.namazId, t.position)],
);

export const questionOptions = pgTable(
  'question_options',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    labelKg: text('label_kg').notNull().default(''),
    labelRu: text('label_ru').notNull().default(''),
    points: integer('points').notNull().default(0),
    /** Надписи заданы типом вопроса (шкала, да/нет): меняются только баллы. */
    locked: boolean('locked').notNull().default(false),
  },
  (t) => [index('question_options_question_idx').on(t.questionId, t.position)],
);

/* ───────────────── участницы ───────────────── */

export const participants = pgTable(
  'participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tgUserId: text('tg_user_id').notNull(),
    chatId: text('chat_id').notNull(),
    firstName: text('first_name').notNull().default(''),
    /** Нужна только для рейтинга: имён вроде «Нургүл» в марафоне десяток. */
    lastName: text('last_name').notNull().default(''),
    username: text('username'),
    lang: langEnum('lang').notNull().default('kg'),
    /** Округлены до 2 знаков: это и ключ кэша, и требование приватности. */
    lat: real('lat'),
    lng: real('lng'),
    tz: text('tz'),
    placeLabel: text('place_label'),
    countryCode: text('country_code'),
    locationSource: locationSource('location_source'),
    blocked: boolean('blocked').notNull().default(false),
    tahajjudReminders: boolean('tahajjud_reminders').notNull().default(false),
    activeEnrollmentId: uuid('active_enrollment_id'),
    nextMarathonInterest: boolean('next_marathon_interest').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('participants_tg_user_id_key').on(t.tgUserId), index('participants_tz_idx').on(t.tz)],
);

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    participantId: uuid('participant_id').notNull().references(() => participants.id, { onDelete: 'cascade' }),
    marathonId: uuid('marathon_id').notNull().references(() => marathons.id, { onDelete: 'cascade' }),
    status: enrollmentStatus('status').notNull().default('active'),
    /** Зачем пришла в марафон — своими словами, спрашивается при записи. */
    goal: text('goal'),
    /** Когда согласилась с правилами марафона. Без согласия записи нет. */
    rulesAcceptedAt: timestamp('rules_accepted_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    pausedUntil: date('paused_until'),
    points: integer('points').notNull().default(0),
    streak: integer('streak').notNull().default(0),
    bestStreak: integer('best_streak').notNull().default(0),
    latePassesUsed: integer('late_passes_used').notNull().default(0),
    /** Когда бот прислал кнопку «вступить в канал». */
    channelInvitedAt: timestamp('channel_invited_at', { withTimezone: true }),
    /** Когда бот одобрил её заявку в канал; сбрасывается, когда её оттуда убрали. */
    channelJoinedAt: timestamp('channel_joined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('enrollments_participant_marathon_key').on(t.participantId, t.marathonId),
    index('enrollments_marathon_idx').on(t.marathonId, t.status),
  ],
);

/* ───────────────── отчёты и баллы ───────────────── */

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    enrollmentId: uuid('enrollment_id').notNull().references(() => enrollments.id, { onDelete: 'cascade' }),
    topicKind: topicKind('topic_kind').notNull(),
    /** Текст: 't1'…'t11' для намазов, uuid для своих тем. Пересечений нет. */
    topicId: text('topic_id').notNull(),
    dayKey: date('day_key').notNull(),
    windowOpensAt: timestamp('window_opens_at', { withTimezone: true }).notNull(),
    windowClosesAt: timestamp('window_closes_at', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    late: boolean('late').notNull().default(false),
    /**
     * Видео не храним: только идентификаторы и длительность. В канал марафона
     * бот перезаливает кружок на лету, ничего не сохраняя на диск.
     */
    videoFileId: text('video_file_id').notNull(),
    videoFileUniqueId: text('video_file_unique_id').notNull(),
    videoDurationSec: integer('video_duration_sec'),
    pointsAwarded: integer('points_awarded').notNull().default(0),
    answers: jsonb('answers').$type<Record<string, unknown>>(),
    /**
     * Публикация в канал марафона. Пусто — канала не было, когда отчёт приняли;
     * `pending` ждёт очереди, дальше `posted`, `failed` или `skipped`.
     */
    channelState: text('channel_state'),
    channelChatId: text('channel_chat_id'),
    channelMessageId: integer('channel_message_id'),
    channelAttempts: smallint('channel_attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('reports_enrollment_topic_day_key').on(t.enrollmentId, t.topicId, t.dayKey),
    uniqueIndex('reports_video_unique_key').on(t.videoFileUniqueId),
    index('reports_enrollment_day_idx').on(t.enrollmentId, t.dayKey),
    index('reports_channel_pending_idx').on(t.submittedAt).where(sql`${t.channelState} = 'pending'`),
  ],
);

export const excusedDays = pgTable(
  'excused_days',
  {
    enrollmentId: uuid('enrollment_id').notNull().references(() => enrollments.id, { onDelete: 'cascade' }),
    dayKey: date('day_key').notNull(),
    /** `day` — уважительный день от куратора, `namaz` — узур, отмеченный самой участницей. */
    scope: excusedScope('scope').notNull().default('day'),
    markedBy: uuid('marked_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.enrollmentId, t.dayKey] })],
);

/** Любое изменение баллов проходит через эту таблицу. */
export const pointsLedger = pgTable(
  'points_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    enrollmentId: uuid('enrollment_id').notNull().references(() => enrollments.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    actorAdminId: uuid('actor_admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('points_ledger_enrollment_idx').on(t.enrollmentId, t.createdAt)],
);

/** Идемпотентность напоминаний и подсчёт дневного лимита. */
export const remindersLog = pgTable(
  'reminders_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    enrollmentId: uuid('enrollment_id').notNull().references(() => enrollments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    topicId: text('topic_id'),
    dayKey: date('day_key').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('sent'),
  },
  (t) => [
    // У утренних, вечерних, недельных записей и у оценки дня topic_id равен
    // NULL, а NULL в обычном уникальном индексе не конфликтует сам с собой:
    // после перезапуска сводка ушла бы второй раз. Отсюда NULLS NOT DISTINCT.
    unique('reminders_log_key').on(t.kind, t.enrollmentId, t.topicId, t.dayKey).nullsNotDistinct(),
    index('reminders_log_day_idx').on(t.enrollmentId, t.dayKey),
  ],
);

/** Незавершённый отчёт: выбор темы и ответы. Живёт 15 минут. */
export const reportDrafts = pgTable(
  'report_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    participantId: uuid('participant_id').notNull().references(() => participants.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id').notNull().references(() => enrollments.id, { onDelete: 'cascade' }),
    topicKind: topicKind('topic_kind'),
    topicId: text('topic_id'),
    dayKey: date('day_key'),
    windowOpensAt: timestamp('window_opens_at', { withTimezone: true }),
    windowClosesAt: timestamp('window_closes_at', { withTimezone: true }),
    late: boolean('late').notNull().default(false),
    videoFileId: text('video_file_id').notNull(),
    videoFileUniqueId: text('video_file_unique_id').notNull(),
    videoDurationSec: integer('video_duration_sec'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    questionIndex: integer('question_index').notNull().default(0),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('report_drafts_participant_idx').on(t.participantId), index('report_drafts_expires_idx').on(t.expiresAt)],
);

/* ───────────────── рассылки ───────────────── */

export const broadcasts = pgTable('broadcasts', {
  id: uuid('id').defaultRandom().primaryKey(),
  marathonId: uuid('marathon_id').notNull().references(() => marathons.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  segment: jsonb('segment').$type<Record<string, unknown>>().notNull(),
  schedule: jsonb('schedule').$type<Record<string, unknown>>().notNull(),
  status: broadcastStatus('status').notNull().default('scheduled'),
  totals: jsonb('totals').$type<Record<string, number>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const broadcastDeliveries = pgTable(
  'broadcast_deliveries',
  {
    broadcastId: uuid('broadcast_id').notNull().references(() => broadcasts.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id').notNull().references(() => participants.id, { onDelete: 'cascade' }),
    status: deliveryStatus('status').notNull().default('pending'),
    sendAfter: timestamp('send_after', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [
    primaryKey({ columns: [t.broadcastId, t.participantId] }),
    index('broadcast_deliveries_pending_idx').on(t.status, t.sendAfter),
  ],
);

/* ───────────────── каналы, где бот админ ───────────────── */

/**
 * Каналы, куда бота добавили. Запись появляется по апдейту my_chat_member —
 * ещё до того, как канал привязан к марафону: так панель может предложить
 * «это ваш канал?», если ссылка не совпала.
 */
export const botChannels = pgTable('bot_channels', {
  chatId: text('chat_id').primaryKey(),
  title: text('title').notNull().default(''),
  /** Публичное имя; у закрытого канала его нет. */
  username: text('username'),
  /** Основная ссылка-приглашение: по ней узнаём канал из панели. */
  inviteLink: text('invite_link'),
  /** Статус бота в канале: administrator, left, kicked… */
  status: text('status').notNull(),
  canPost: boolean('can_post').notNull().default(false),
  canInvite: boolean('can_invite').notNull().default(false),
  canRestrict: boolean('can_restrict').notNull().default(false),
  /** «Запретить копирование»: видео нельзя сохранить или переслать. */
  protectedContent: boolean('protected_content').notNull().default(false),
  /** Кто добавил бота — Telegram id админа канала. */
  addedBy: text('added_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────── настройки бота ───────────────── */

export const botTexts = pgTable('bot_texts', {
  key: text('key').primaryKey(),
  ru: text('ru').notNull().default(''),
  kg: text('kg').notNull().default(''),
  placeholders: text('placeholders').array().notNull().default(sql`'{}'::text[]`),
});

export const botSettings = pgTable('bot_settings', {
  id: smallint('id').primaryKey().default(1),
  quietFrom: time('quiet_from').notNull().default('22:30'),
  quietTo: time('quiet_to').notNull().default('04:30'),
  /** Лимит напоминаний о темах в день; 0 — без лимита, о каждой теме. */
  capPerDay: integer('cap_per_day').notNull().default(0),
  menu: jsonb('menu').$type<string[]>().notNull().default([]),
  commands: jsonb('commands').$type<{ command: string; description: string }[]>().notNull().default([]),
  description: text('description').notNull().default(''),
  shortDescription: text('short_description').notNull().default(''),
  prayerTune: jsonb('prayer_tune').$type<Record<string, number>>().notNull().default({}),
  methodVersion: text('method_version').notNull().default(''),
});

export const locationPresets = pgTable('location_presets', {
  id: uuid('id').defaultRandom().primaryKey(),
  position: integer('position').notNull().default(0),
  labelRu: text('label_ru').notNull(),
  labelKg: text('label_kg').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  tz: text('tz').notNull(),
});

/** GeoNames cities1000, CC BY 4.0. */
export const geonames = pgTable(
  'geonames',
  {
    geonameid: integer('geonameid').primaryKey(),
    name: text('name').notNull(),
    asciiname: text('asciiname').notNull().default(''),
    alternatenames: text('alternatenames').notNull().default(''),
    /** Нормализованное основное имя: точное совпадение с ним важнее всего. */
    nameNorm: text('name_norm').notNull().default(''),
    /** Основное имя плюс все альтернативные — для нечёткого поиска. */
    searchText: text('search_text').notNull().default(''),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    countryCode: text('country_code').notNull().default(''),
    admin1: text('admin1').notNull().default(''),
    population: integer('population').notNull().default(0),
    timezone: text('timezone').notNull().default(''),
  },
  (t) => [index('geonames_population_idx').on(t.population), index('geonames_name_norm_idx').on(t.nameNorm)],
);

export const prayerTimesCache = pgTable(
  'prayer_times',
  {
    lat2: real('lat2').notNull(),
    lng2: real('lng2').notNull(),
    localDate: date('local_date').notNull(),
    methodVersion: text('method_version').notNull(),
    fajr: timestamp('fajr', { withTimezone: true }).notNull(),
    sunrise: timestamp('sunrise', { withTimezone: true }).notNull(),
    dhuhr: timestamp('dhuhr', { withTimezone: true }).notNull(),
    asr: timestamp('asr', { withTimezone: true }).notNull(),
    maghrib: timestamp('maghrib', { withTimezone: true }).notNull(),
    isha: timestamp('isha', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.lat2, t.lng2, t.localDate, t.methodVersion] })],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorAdminId: uuid('actor_admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    actorLabel: text('actor_label').notNull().default(''),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt)],
);

/** Сессии диалогов grammY — чтобы флоу переживали перезапуск. */
export const botSessions = pgTable('bot_sessions', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Дедупликация update_id вебхука на 24 часа. */
export const telegramUpdates = pgTable('telegram_updates', {
  updateId: text('update_id').primaryKey(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────── связи ───────────────── */

export const marathonsRelations = relations(marathons, ({ many }) => ({
  topics: many(topics),
  namaz: many(marathonNamaz),
  enrollments: many(enrollments),
}));

export const topicsRelations = relations(topics, ({ one, many }) => ({
  marathon: one(marathons, { fields: [topics.marathonId], references: [marathons.id] }),
  questions: many(questions),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  topic: one(topics, { fields: [questions.topicId], references: [topics.id] }),
  options: many(questionOptions),
}));

export const questionOptionsRelations = relations(questionOptions, ({ one }) => ({
  question: one(questions, { fields: [questionOptions.questionId], references: [questions.id] }),
}));

export const participantsRelations = relations(participants, ({ many }) => ({
  enrollments: many(enrollments),
}));

export const enrollmentsRelations = relations(enrollments, ({ one, many }) => ({
  participant: one(participants, { fields: [enrollments.participantId], references: [participants.id] }),
  marathon: one(marathons, { fields: [enrollments.marathonId], references: [marathons.id] }),
  reports: many(reports),
  ledger: many(pointsLedger),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  enrollment: one(enrollments, { fields: [reports.enrollmentId], references: [enrollments.id] }),
}));
