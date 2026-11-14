import { fileUrl, request } from './client';
import type {
  AdminUserDto, AnalyticsDto, AuditEntryDto, BotSettingsDto, BotTextDto, BroadcastDto, BroadcastProgressDto, ChannelStatusDto,
  MarathonDto, MeDto, NamazDto, OverviewDto, ParticipantDetailDto, ParticipantRowDto, PrayerPresetDto,
  PrayerTimesDto, QuestionDto, QuestionTypeDto, Role, TelegramAuthPayload, TopicDto, ValidationDto,
} from './dto';

/**
 * Все маршруты админ-API в одном месте, по одной функции на маршрут.
 * Имена полей запросов — как у бэкенда; перевод из модели панели делает `map.ts`.
 */

/* ───────── вход ───────── */

export const api = {
  me: () => request<MeDto>('/me', { silent401: true }),
  loginTelegram: (payload: TelegramAuthPayload) =>
    request<{ id: string; name: string; role: Role }>('/auth/telegram', { method: 'POST', body: payload }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  /* ───────── марафоны ───────── */

  marathons: () => request<MarathonDto[]>('/marathons'),
  marathon: (id: string) => request<MarathonDto>(`/marathons/${id}`),
  createMarathon: (body: {
    code: string;
    name: string;
    startDate: string;
    endDate: string;
    channelLink: string;
    defaultLang?: 'kg' | 'ru';
  }) => request<MarathonDto>('/marathons', { method: 'POST', body }),
  patchMarathon: (id: string, body: Record<string, unknown>) =>
    request<MarathonDto>(`/marathons/${id}`, { method: 'PATCH', body }),
  deleteMarathon: (id: string) => request<{ ok: true }>(`/marathons/${id}`, { method: 'DELETE' }),
  /** Копия: темы и намазы переносятся, канал — обязательно свой. */
  duplicateMarathon: (id: string, body: { name: string; startDate: string; endDate: string; channelLink: string }) =>
    request<MarathonDto>(`/marathons/${id}/duplicate`, { method: 'POST', body }),

  /* ───────── канал отчётов ───────── */

  /** Живая проверка: бот в канале, права, запрет копирования. */
  channelStatus: (id: string) => request<ChannelStatusDto>(`/marathons/${id}/channel`),
  channelConnect: (id: string, chatId: string) =>
    request<ChannelStatusDto>(`/marathons/${id}/channel/connect`, { method: 'POST', body: { chatId } }),
  channelDisconnect: (id: string) => request<ChannelStatusDto>(`/marathons/${id}/channel/disconnect`, { method: 'POST' }),
  validation: (id: string) => request<ValidationDto>(`/marathons/${id}/validation`),
  launch: (id: string) => request<MarathonDto>(`/marathons/${id}/launch`, { method: 'POST' }),
  overview: (id: string) => request<OverviewDto>(`/marathons/${id}/overview`),

  /* ───────── намазы ───────── */

  namazLibrary: () => request<NamazDto[]>('/namaz'),
  /** `confirm: true` обязателен, если из идущего марафона убирают намаз. */
  setNamaz: (id: string, ids: string[], confirm?: boolean) =>
    request<{ ids: string[] }>(`/marathons/${id}/namaz`, { method: 'PUT', body: { ids, confirm } }),

  /* ───────── свои темы ───────── */

  topics: (marathonId: string) => request<TopicDto[]>(`/marathons/${marathonId}/topics`),
  createTopic: (marathonId: string, body: Record<string, unknown>) =>
    request<TopicDto>(`/marathons/${marathonId}/topics`, { method: 'POST', body }),
  patchTopic: (id: string, body: Record<string, unknown>) =>
    request<TopicDto>(`/topics/${id}`, { method: 'PATCH', body }),
  deleteTopic: (id: string) => request<{ ok: true }>(`/topics/${id}`, { method: 'DELETE' }),
  reorderTopics: (marathonId: string, ids: string[]) =>
    request<{ ids: string[] }>(`/marathons/${marathonId}/topics/reorder`, { method: 'POST', body: { ids } }),

  /* ───────── вопросы и варианты ───────── */

  createQuestion: (topicId: string, body: { type?: QuestionTypeDto; required?: boolean; textKg?: string; textRu?: string }) =>
    request<QuestionDto>(`/topics/${topicId}/questions`, { method: 'POST', body }),
  patchQuestion: (id: string, body: Record<string, unknown>) =>
    request<QuestionDto>(`/questions/${id}`, { method: 'PATCH', body }),
  deleteQuestion: (id: string) => request<{ ok: true }>(`/questions/${id}`, { method: 'DELETE' }),
  reorderQuestions: (topicId: string, ids: string[]) =>
    request<{ ids: string[] }>(`/topics/${topicId}/questions/reorder`, { method: 'POST', body: { ids } }),

  createOption: (questionId: string, body: { labelKg?: string; labelRu?: string; points?: number }) =>
    request<{ id: string }>(`/questions/${questionId}/options`, { method: 'POST', body }),
  patchOption: (id: string, body: Record<string, unknown>) =>
    request<{ id: string }>(`/options/${id}`, { method: 'PATCH', body }),
  deleteOption: (id: string) => request<{ ok: true }>(`/options/${id}`, { method: 'DELETE' }),
  reorderOptions: (questionId: string, ids: string[]) =>
    request<{ ids: string[] }>(`/questions/${questionId}/options/reorder`, { method: 'POST', body: { ids } }),

  /* ───────── участницы ───────── */

  participants: (marathonId: string) => request<ParticipantRowDto[]>(`/marathons/${marathonId}/participants`),
  participant: (id: string, marathonId: string) =>
    request<ParticipantDetailDto>(`/participants/${id}`, { query: { marathon: marathonId } }),
  setParticipantStatus: (id: string, marathonId: string, status: 'active' | 'paused' | 'left' | 'finished') =>
    request<unknown>(`/participants/${id}`, { method: 'PATCH', body: { marathonId, status } }),
  adjustPoints: (id: string, marathonId: string, delta: number, reason: string) =>
    request<{ points: number }>(`/participants/${id}/points`, { method: 'POST', body: { marathonId, delta, reason } }),
  excuseDay: (id: string, marathonId: string, day: string) =>
    request<{ ok: true }>(`/participants/${id}/excused`, { method: 'POST', body: { marathonId, day } }),
  removeParticipant: (id: string, marathonId: string) =>
    request<{ ok: true }>(`/participants/${id}`, { method: 'DELETE', query: { marathon: marathonId } }),
  /** CSV отдаёт сам бэкенд — с BOM и точкой с запятой, чтобы Excel не ломался. */
  participantsCsvUrl: (marathonId: string) => fileUrl(`/marathons/${marathonId}/participants.csv`),

  /* ───────── рассылки ───────── */

  broadcastPreview: (marathonId: string, segment: unknown, text?: string) =>
    request<{ count: number; sample: string | null }>(`/marathons/${marathonId}/broadcasts/preview`, {
      method: 'POST',
      body: { segment, text },
    }),
  createBroadcast: (marathonId: string, body: { text: string; segment: unknown; schedule: unknown }) =>
    request<{ id: string; count: number }>(`/marathons/${marathonId}/broadcasts`, { method: 'POST', body }),
  broadcasts: (marathonId: string) => request<BroadcastDto[]>(`/marathons/${marathonId}/broadcasts`),
  broadcastProgress: (id: string) => request<BroadcastProgressDto>(`/broadcasts/${id}`),

  /* ───────── аналитика и намазы ───────── */

  analytics: (marathonId: string) => request<AnalyticsDto>(`/marathons/${marathonId}/analytics`),
  prayerPresets: () => request<PrayerPresetDto[]>('/prayer/presets'),
  prayerTimes: (lat: number, lng: number, date?: string) =>
    request<PrayerTimesDto>('/prayer/times', { query: { lat, lng, date } }),

  /* ───────── бот ───────── */

  botSettings: () => request<BotSettingsDto>('/bot/settings'),
  patchBotSettings: (body: Record<string, unknown>) =>
    request<BotSettingsDto>('/bot/settings', { method: 'PATCH', body }),
  setBotName: (name: string) => request<{ ok: true; name: string }>('/bot/name', { method: 'POST', body: { name } }),
  botTexts: () => request<BotTextDto[]>('/bot/texts'),
  patchBotText: (key: string, body: { ru?: string; kg?: string }) =>
    request<BotTextDto>(`/bot/texts/${encodeURIComponent(key)}`, { method: 'PATCH', body }),

  /* ───────── пользователи панели и журнал ───────── */

  users: () => request<AdminUserDto[]>('/users'),
  addUser: (body: { name: string; tgUsername: string; role: Role }) =>
    request<AdminUserDto>('/users', { method: 'POST', body }),
  setUserRole: (id: string, role: Role) => request<AdminUserDto>(`/users/${id}`, { method: 'PATCH', body: { role } }),
  disableUser: (id: string) => request<{ ok: true }>(`/users/${id}`, { method: 'DELETE' }),
  audit: (limit = 100) => request<AuditEntryDto[]>('/audit', { query: { limit } }),
};
