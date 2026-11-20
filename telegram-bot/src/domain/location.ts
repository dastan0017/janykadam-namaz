import { find as findTz } from 'geo-tz';
import { DateTime } from 'luxon';
import { roundCoord } from './prayer';

/**
 * Место участницы. Часовой пояс всегда выводится из координат: одной зоны
 * недостаточно, потому что время намаза зависит от точки, а не от пояса —
 * Бишкек и Ош в Asia/Bishkek расходятся на 5–15 минут.
 */

export type LocationSource = 'preset' | 'search' | 'geo';

export interface Location {
  lat: number;
  lng: number;
  tz: string;
  placeLabel: string;
  countryCode: string;
  source: LocationSource;
}

/** IANA-зона по координатам, оффлайн. */
export function tzFromCoords(lat: number, lng: number): string {
  const zones = findTz(lat, lng);
  if (zones.length === 0) throw new Error(`Не удалось определить пояс для ${lat},${lng}`);
  return zones[0];
}

/**
 * Строит место из координат. Для пресетов и результатов поиска пояс приходит из
 * GeoNames; если он расходится с geo-tz, доверяем geo-tz и сообщаем об этом.
 */
export function buildLocation(input: {
  lat: number;
  lng: number;
  placeLabel: string;
  countryCode: string;
  source: LocationSource;
  declaredTz?: string;
  onTzMismatch?: (info: { declared: string; actual: string; lat: number; lng: number }) => void;
}): Location {
  const lat = roundCoord(input.lat);
  const lng = roundCoord(input.lng);
  const actual = tzFromCoords(lat, lng);

  if (input.declaredTz && input.declaredTz !== actual) {
    input.onTzMismatch?.({ declared: input.declaredTz, actual, lat, lng });
  }

  return {
    lat,
    lng,
    tz: actual,
    placeLabel: input.placeLabel,
    countryCode: input.countryCode,
    source: input.source,
  };
}

/**
 * Смещение зоны «сейчас», как `UTC+6` или `UTC−5`.
 * Считается на текущий момент, поэтому Нью-Йорк зимой показывает UTC−5, летом UTC−4.
 */
export function utcOffsetLabel(tz: string, at: Date = new Date()): string {
  const dt = DateTime.fromJSDate(at, { zone: tz });
  const minutes = dt.offset;
  const sign = minutes < 0 ? '−' : '+'; // U+2212, читается лучше дефиса
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

/** Локализованное название страны по ISO-коду. */
export function countryName(code: string, lang: 'ru' | 'ky'): string {
  if (!code) return '';
  try {
    const dn = new Intl.DisplayNames([lang, 'ru'], { type: 'region' });
    return dn.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Подпись места для кнопки или подтверждения: «Талас, Кыргызстан · UTC+6». */
export function placeLabelWithOffset(placeLabel: string, countryCode: string, tz: string, lang: 'ru' | 'ky', at?: Date): string {
  const country = countryName(countryCode, lang);
  const place = country ? `${placeLabel}, ${country}` : placeLabel;
  return `${place} · ${utcOffsetLabel(tz, at)}`;
}
