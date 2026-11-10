import { setPrayerPresets } from '../data/constants';
import type { AppState, MarathonData } from '../types';
import { api } from './endpoints';
import { ApiError } from './client';
import {
  applyNamazLibrary, toAuditEntry, toBotSettings, toBotText, toBroadcast, toMarathon, toPanelUser,
  toParticipant, toPresetTimes, toTopic,
} from './map';

/**
 * Сборка состояния панели из ответов API.
 *
 * Общие данные (марафоны, библиотека намазов, время намазов, настройки и тексты
 * бота, пользователи, журнал) грузятся один раз при входе. Данные марафона —
 * при его открытии: на старте не нужно тянуть участниц всех марафонов сразу.
 */

export type GlobalPatch = Pick<AppState, 'marathons' | 'bot' | 'texts' | 'users' | 'audit'>;

/** Куратору `/api/users` отдаёт 403 — это не ошибка, просто раздел ему недоступен. */
async function usersOrEmpty() {
  try {
    return await api.users();
  } catch (err) {
    if (err instanceof ApiError && err.forbidden) return [];
    throw err;
  }
}

export async function loadGlobal(): Promise<GlobalPatch> {
  const [marathons, namaz, presets, botSettings, texts, users, audit] = await Promise.all([
    api.marathons(),
    api.namazLibrary(),
    api.prayerPresets(),
    api.botSettings(),
    api.botTexts(),
    usersOrEmpty(),
    api.audit(100),
  ]);

  // Справочники — в модульный реестр: экраны читают их синхронно.
  applyNamazLibrary(namaz);
  setPrayerPresets(presets.map(toPresetTimes).map((p) => ({ tz: p.tz, city: p.city, pt: p.pt as never })));

  return {
    marathons: marathons.map(toMarathon),
    bot: toBotSettings(botSettings, botSettings.username, botSettings.name),
    texts: texts.map(toBotText),
    users: users.map(toPanelUser),
    audit: audit.map(toAuditEntry),
  };
}

/** Данные одного марафона: темы, намазы, участницы, рассылки, тренд. */
export async function loadMarathon(id: string): Promise<MarathonData> {
  const [topics, marathon, participants, broadcasts, overview] = await Promise.all([
    api.topics(id),
    api.marathon(id),
    api.participants(id),
    api.broadcasts(id),
    api.overview(id),
  ]);

  // Тренд — доля сдавших по дням. Берём активных на сегодня как знаменатель:
  // прошлой численности в базе нет, и честнее показать долю от нынешней.
  const base = overview.activeCount || participants.filter((p) => p.status === 'active').length || 1;
  const trend = overview.trend.map((d) => Math.min(100, Math.round((d.n / base) * 100)));

  return {
    topics: topics.map(toTopic),
    namaz: marathon.namazIds ?? [],
    participants: participants.map(toParticipant),
    trend,
    ledger: {},
    recent: {},
    broadcasts: broadcasts.map(toBroadcast),
  };
}

/** Журнал баллов одной участницы — грузится, когда открывают её карточку. */
export async function loadLedger(participantId: string, marathonId: string) {
  const detail = await api.participant(participantId, marathonId);
  return detail;
}
