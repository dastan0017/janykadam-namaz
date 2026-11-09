import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PrayerTimes, type CalculationParameters } from 'adhan';

/**
 * Движок времён намаза. Чистая функция: ни Telegram, ни БД.
 *
 * Метод — Aladhan № 14 (ДУМ России): Фаджр 16°, Иша 15°, Аср по ханафитскому
 * мазхабу. Считается локально пакетом adhan, без обращений к API в рантайме.
 */

export type PrayerName = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export const PRAYER_NAMES: readonly PrayerName[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

/** Поправки в минутах, чтобы позже выровняться по таблице Муфтията КР. */
export type PrayerTune = Record<PrayerName, number>;

export const ZERO_TUNE: PrayerTune = { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };

/** Моменты времени в UTC. */
export type PrayerInstants = Record<PrayerName, Date>;

export interface PrayerOptions {
  tune?: PrayerTune;
  /** Широта, до которой «схлопывается» расчёт в полярных областях. */
  polarFallbackLat?: number;
  onPolarFallback?: (info: { lat: number; lng: number; localDate: string }) => void;
}

const DEFAULT_POLAR_FALLBACK_LAT = 48.5;

const FAJR_ANGLE = 16;
const ISHA_ANGLE = 15;

function buildParams(coords: Coordinates): CalculationParameters {
  const params = CalculationMethod.Other();
  params.fajrAngle = FAJR_ANGLE;
  params.ishaAngle = ISHA_ANGLE;
  params.madhab = Madhab.Hanafi;
  params.highLatitudeRule = HighLatitudeRule.recommended(coords);
  return params;
}

/**
 * adhan берёт год/месяц/день локальными геттерами JS-даты. Процесс работает с
 * TZ=UTC (это проверяется на старте), поэтому дату строим через Date.UTC —
 * тогда компоненты совпадают с запрошенной календарной датой.
 */
function dateFromLocalDate(localDate: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) throw new Error(`Ожидается дата вида YYYY-MM-DD, получено: ${localDate}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function roundToMinute(d: Date): Date {
  return new Date(Math.round(d.getTime() / 60_000) * 60_000);
}

function isValid(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function computeRaw(lat: number, lng: number, localDate: string): Partial<Record<PrayerName, Date>> {
  const coords = new Coordinates(lat, lng);
  const times = new PrayerTimes(coords, dateFromLocalDate(localDate), buildParams(coords));
  const out: Partial<Record<PrayerName, Date>> = {};
  for (const name of PRAYER_NAMES) {
    const v = times[name] as unknown;
    if (isValid(v)) out[name] = v;
  }
  return out;
}

/**
 * Времена намаза для координат и локальной календарной даты.
 *
 * В высоких широтах часть времён может быть не определена даже с
 * highLatitudeRule — тогда пересчитываем с широтой, прижатой к ±48.5°,
 * сохраняя долготу.
 */
export function prayerTimes(lat: number, lng: number, localDate: string, opts: PrayerOptions = {}): PrayerInstants {
  const tune = opts.tune ?? ZERO_TUNE;
  const fallbackLat = opts.polarFallbackLat ?? DEFAULT_POLAR_FALLBACK_LAT;

  let raw = computeRaw(lat, lng, localDate);

  if (PRAYER_NAMES.some((n) => raw[n] === undefined)) {
    const clamped = Math.max(-fallbackLat, Math.min(fallbackLat, lat));
    opts.onPolarFallback?.({ lat, lng, localDate });
    raw = computeRaw(clamped, lng, localDate);
  }

  const out = {} as PrayerInstants;
  for (const name of PRAYER_NAMES) {
    const base = raw[name];
    if (!base) {
      // После фолбэка такого быть не должно; если случилось — это баг, а не данные.
      throw new Error(`Не удалось вычислить ${name} для ${lat},${lng} на ${localDate}`);
    }
    out[name] = roundToMinute(new Date(base.getTime() + tune[name] * 60_000));
  }
  return out;
}

/**
 * Версия метода расчёта. Входит в ключ кэша: поменяли поправки — поменялась
 * версия, старый кэш перестаёт использоваться.
 */
export function methodVersion(tune: PrayerTune = ZERO_TUNE): string {
  const t = PRAYER_NAMES.map((n) => tune[n] ?? 0).join(',');
  return `mufti-ru-f${FAJR_ANGLE}-i${ISHA_ANGLE}-hanafi-v1[${t}]`;
}

/** Координаты округляются до 2 знаков: это ключ кэша и требование приватности. */
export function roundCoord(v: number): number {
  return Math.round(v * 100) / 100;
}
