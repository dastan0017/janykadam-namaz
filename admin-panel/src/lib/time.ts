import { FALLBACK_TZ, NAMAZ, TZ, utcLabel } from '../data/constants';
import type { AnchorSpec, AnyTopic, NamazDef, NamazTopic, TzKey } from '../types';

/**
 * Время в панели.
 *
 * Пояс — зона IANA, как её хранит бот (`Asia/Bishkek`): одной зоны мало,
 * потому что время намаза зависит от точки, но для подписей и местных часов
 * зоны достаточно. Время намазов на сегодня лежит в реестре `TZ`, его
 * заполняет загрузка из `/api/prayer/presets`.
 */

/** «07:35» → 455 минут от полуночи. */
export function toMin(s: string): number {
  const [h, m] = (s || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
}

/** 455 → «07:35». Значения вне суток сворачиваются в сутки. */
export function fmt(m: number): string {
  const v = ((m % 1440) + 1440) % 1440;
  return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
}

/** Текущее местное время в поясе — минуты от полуночи. */
export function localNow(tz: TzKey): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || FALLBACK_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return (h % 24) * 60 + m;
  } catch {
    return 0;
  }
}

/** Местная календарная дата в поясе, `YYYY-MM-DD`. */
export function localDate(tz: TzKey, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || FALLBACK_TZ, dateStyle: 'short' }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(at);
  }
}

/** «Бишкек · UTC+6» — место участницы плюс смещение её зоны. */
export function placeLabel(place: string, tz: TzKey): string {
  const where = place.trim() || TZ[tz]?.city || tz.split('/').pop()?.replace(/_/g, ' ') || '—';
  return `${where} · ${TZ[tz]?.utc ?? utcLabel(tz)}`;
}

/** «Бишкек · UTC+6». Для зоны вне справочника — её последний сегмент. */
export function tzLabel(k: TzKey): string {
  const z = TZ[k];
  if (z) return `${z.city} · ${z.utc}`;
  if (!k) return '—';
  const city = k.split('/').pop()?.replace(/_/g, ' ') ?? k;
  return `${city} · ${utcLabel(k)}`;
}

/** «2026-11-08» → «8 ноя». */
export function dayLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const [, m, d] = iso.split('-');
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${Number(d)} ${months[Number(m) - 1] ?? ''}`.trim();
}

/** Сдвигает календарную дату на дни: `shiftDay('2026-11-08', -1)` → `2026-11-07`. */
export function shiftDay(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Номер дня марафона: 1 — день старта. */
export function dayNumber(startDate: string, today = localDate(FALLBACK_TZ)): number {
  const diff = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(diff)) return 1;
  return Math.floor(diff / 86_400_000) + 1;
}

/** Сколько дней всего в марафоне, включая первый и последний. */
export function dayCount(startDate: string, endDate: string): number {
  const diff = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(diff)) return 0;
  return Math.floor(diff / 86_400_000) + 1;
}

/** Тема-намаз в форме обычной темы — для общих расчётов и списков. */
export function nsTopic(n: NamazDef): NamazTopic {
  return {
    id: n.id,
    sys: true,
    emoji: n.emoji,
    nameKg: n.nameKg,
    nameRu: n.nameRu,
    points: n.points,
    mandatory: n.mandatory,
    active: true,
    freq: 'daily',
    remind: 0,
    questions: n.questions ?? [],
  };
}

/**
 * Окно сдачи темы в минутах от местной полуночи.
 *
 * Конец может быть больше 1440: окно Куптана идёт до фаджра следующего дня.
 * Подписи сворачивают это обратно в сутки, а `openNow` учитывает переход.
 */
export function win(t: AnyTopic, tz: TzKey = FALLBACK_TZ): { s: number; e: number } {
  if (t.sys) {
    const n = NAMAZ.find((x) => x.id === t.id);
    const pt = (TZ[tz] ?? TZ[FALLBACK_TZ])?.pt;
    if (!n || !pt) return { s: 0, e: 0 };

    const at = ([k, o]: AnchorSpec): number => {
      if (k === 'fixed') return o;
      if (k === 'midnight') return 1439;
      if (k === 'nextFajr') return pt.fajr + 1440 + o;
      return pt[k] + o;
    };
    return { s: at(n.s), e: at(n.e) };
  }
  return { s: toMin(t.start), e: toMin(t.end) };
}

export function winStr(t: AnyTopic, tz: TzKey = FALLBACK_TZ): string {
  const w = win(t, tz);
  return fmt(w.s) + '–' + fmt(w.e);
}

/** Открыта ли тема прямо сейчас по времени этого пояса. */
export function openNow(t: AnyTopic, tz: TzKey = FALLBACK_TZ): boolean {
  const now = localNow(tz);
  const w = win(t, tz);
  if (w.e <= w.s) return false;
  // Окно, перешедшее полночь: ночью «сейчас» лежит в следующих сутках.
  return (w.s <= now && now < w.e) || (w.e > 1440 && now + 1440 < w.e && w.s <= now + 1440);
}
