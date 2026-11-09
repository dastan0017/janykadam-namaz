import { NAMAZ, NOW, TZ } from '../data/constants';
import type { AnchorSpec, AnyTopic, NamazDef, NamazTopic, TzKey } from '../types';

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
  const z = TZ[tz] ?? TZ.bishkek;
  return (((NOW + z.off) % 1440) + 1440) % 1440;
}

export function tzLabel(k: TzKey): string {
  const z = TZ[k] ?? TZ.bishkek;
  return z.city + ' · ' + z.utc;
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

/** Окно сдачи темы в минутах: у намазов считается от времени намаза в поясе. */
export function win(t: AnyTopic, tz: TzKey = 'bishkek'): { s: number; e: number } {
  if (t.sys) {
    const n = NAMAZ.find((x) => x.id === t.id);
    if (!n) return { s: 0, e: 0 };
    const pt = (TZ[tz] ?? TZ.bishkek).pt;
    const at = ([k, o]: AnchorSpec): number => (k === 'midnight' ? 1439 : k === 'fixed' ? o : pt[k] + o);
    return { s: at(n.s), e: at(n.e) };
  }
  return { s: toMin(t.start), e: toMin(t.end) };
}

export function winStr(t: AnyTopic, tz: TzKey = 'bishkek'): string {
  const w = win(t, tz);
  return fmt(w.s) + '–' + fmt(w.e);
}

/** Открыта ли тема прямо сейчас по времени этого пояса. */
export function openNow(t: AnyTopic, tz: TzKey = 'bishkek'): boolean {
  const now = localNow(tz);
  const w = win(t, tz);
  return w.s <= now && now < w.e;
}
