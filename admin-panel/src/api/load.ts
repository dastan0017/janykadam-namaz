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

/**
 * Куски общего состояния по отдельности. Экран обновляет только то, что
 * показывает: открытие «Журнала» не должно тянуть ещё и тексты бота.
 */
const PART = {
  marathons: async () => (await api.marathons()).map(toMarathon),
  texts: async () => (await api.botTexts()).map(toBotText),
  users: async () => (await usersOrEmpty()).map(toPanelUser),
  audit: async () => (await api.audit(100)).map(toAuditEntry),
  bot: async () => {
    const b = await api.botSettings();
    return toBotSettings(b, b.username, b.name);
  },
} satisfies { [K in keyof GlobalPatch]: () => Promise<GlobalPatch[K]> };

export type GlobalPart = keyof typeof PART;

/** Обновляет названные куски общего состояния. */
export async function loadParts(parts: GlobalPart[]): Promise<Partial<GlobalPatch>> {
  const done = await Promise.all(parts.map(async (p) => [p, await PART[p]()] as const));
  return Object.fromEntries(done) as Partial<GlobalPatch>;
}

export async function loadGlobal(): Promise<GlobalPatch> {
  const [parts, namaz, presets] = await Promise.all([
    loadParts(['marathons', 'bot', 'texts', 'users', 'audit']),
    api.namazLibrary(),
    api.prayerPresets(),
  ]);

  // Справочники — в модульный реестр: экраны читают их синхронно.
  applyNamazLibrary(namaz);
  setPrayerPresets(presets.map(toPresetTimes).map((p) => ({ tz: p.tz, city: p.city, pt: p.pt as never })));

  return parts as GlobalPatch;
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
