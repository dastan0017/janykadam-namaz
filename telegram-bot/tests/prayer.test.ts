import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { NAMAZ_BY_ID } from '../src/domain/namaz';
import { PRAYER_NAMES, prayerTimes, type PrayerName } from '../src/domain/prayer';
import { localDateShift, namazWindow, toLocalDate, type PrayerLookup } from '../src/domain/windows';

/** Фикстуры раздела 3.7. Допуск ±1 минута. */

const BISHKEK = { lat: 42.8746, lng: 74.5698, tz: 'Asia/Bishkek' };
const OSH = { lat: 40.5283, lng: 72.7985, tz: 'Asia/Bishkek' };
const MOSCOW = { lat: 55.7558, lng: 37.6173, tz: 'Europe/Moscow' };
const SPB = { lat: 59.9311, lng: 30.3609, tz: 'Europe/Moscow' };
const NEW_YORK = { lat: 40.7128, lng: -74.006, tz: 'America/New_York' };
const SEOUL = { lat: 37.5665, lng: 126.978, tz: 'Asia/Seoul' };
const KOLKATA = { lat: 22.5726, lng: 88.3639, tz: 'Asia/Kolkata' };
const KATHMANDU = { lat: 27.7172, lng: 85.324, tz: 'Asia/Kathmandu' };
const TROMSO = { lat: 69.6492, lng: 18.9553, tz: 'Europe/Oslo' };

function localTimes(place: { lat: number; lng: number; tz: string }, date: string): Record<PrayerName, string> {
  const t = prayerTimes(place.lat, place.lng, date);
  const out = {} as Record<PrayerName, string>;
  for (const n of PRAYER_NAMES) out[n] = DateTime.fromJSDate(t[n], { zone: place.tz }).toFormat('HH:mm');
  return out;
}

function minutesApart(a: string, b: string): number {
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return Math.abs(toMin(a) - toMin(b));
}

function expectTime(got: string, want: string) {
  expect(minutesApart(got, want), `получили ${got}, ожидали ${want}`).toBeLessThanOrEqual(1);
}

/** Поиск времён намаза для набора дат — как его видит движок окон. */
function lookupFor(place: { lat: number; lng: number }): PrayerLookup {
  return (localDate) => prayerTimes(place.lat, place.lng, localDate);
}

describe('движок времён намаза', () => {
  it('Бишкек 2026-11-08', () => {
    const t = localTimes(BISHKEK, '2026-11-08');
    expectTime(t.fajr, '06:19');
    expectTime(t.sunrise, '07:44');
    expectTime(t.dhuhr, '12:45');
    expectTime(t.asr, '16:03');
    expectTime(t.maghrib, '17:46');
    expectTime(t.isha, '19:06');
  });

  it('Ош 2026-11-08 — тот же пояс, но на 5–15 минут иначе', () => {
    const t = localTimes(OSH, '2026-11-08');
    expectTime(t.fajr, '06:24');
    expectTime(t.asr, '16:17');
    expectTime(t.maghrib, '17:58');

    const bishkek = localTimes(BISHKEK, '2026-11-08');
    expect(t.fajr).not.toEqual(bishkek.fajr);
  });

  it('Москва 2026-11-08', () => {
    const t = localTimes(MOSCOW, '2026-11-08');
    expectTime(t.fajr, '05:56');
    expectTime(t.sunrise, '07:50');
    expectTime(t.isha, '18:22');
  });

  it('Нью-Йорк 2026-11-08', () => {
    const t = localTimes(NEW_YORK, '2026-11-08');
    expectTime(t.fajr, '05:12');
    expectTime(t.maghrib, '16:44');
  });

  it('Сеул 2026-11-08', () => {
    const t = localTimes(SEOUL, '2026-11-08');
    expectTime(t.fajr, '05:45');
    expectTime(t.isha, '18:41');
  });

  it('дату читает по компонентам UTC, а не по локали процесса', () => {
    // Если бы дата строилась через new Date('2026-11-08'), при TZ со сдвигом
    // назад adhan получил бы 7 ноября. Проверяем, что день именно тот.
    const t = prayerTimes(BISHKEK.lat, BISHKEK.lng, '2026-11-08');
    expect(toLocalDate(t.dhuhr, BISHKEK.tz)).toBe('2026-11-08');
  });

  it('нецелые смещения: Калькутта +5:30 и Катманду +5:45', () => {
    const kolkata = localTimes(KOLKATA, '2026-11-08');
    const kathmandu = localTimes(KATHMANDU, '2026-11-08');
    for (const n of PRAYER_NAMES) {
      expect(kolkata[n]).toMatch(/^\d{2}:\d{2}$/);
      expect(kathmandu[n]).toMatch(/^\d{2}:\d{2}$/);
    }
    // Катманду на 15 минут впереди Калькутты — полуденное время это показывает.
    expect(kathmandu.dhuhr.endsWith(':47') || kathmandu.dhuhr.endsWith(':46')).toBe(true);
  });
});

describe('высокие широты', () => {
  it('Москва и Петербург 21 июня: все шесть времён определены', () => {
    for (const place of [MOSCOW, SPB]) {
      const t = localTimes(place, '2026-06-21');
      for (const n of PRAYER_NAMES) expect(t[n]).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('Петербург 21 июня: иша около 23:10 — поэтому Куптан идёт до фаджра', () => {
    const t = localTimes(SPB, '2026-06-21');
    expectTime(t.isha, '23:10');
  });

  it('Куптан 21 июня непустой и закрывается после открытия', () => {
    for (const place of [MOSCOW, SPB]) {
      const def = NAMAZ_BY_ID.get('t6')!;
      const w = namazWindow(def, '2026-06-21', place.tz, lookupFor(place));
      expect(w.closesAt.getTime()).toBeGreaterThan(w.opensAt.getTime());
      // Остаётся заметно больше часа, в отличие от правила «до полуночи».
      const hours = (w.closesAt.getTime() - w.opensAt.getTime()) / 3_600_000;
      expect(hours).toBeGreaterThan(1);
    }
  });

  it('Тромсё 21 июня: без исключения, срабатывает полярный фолбэк', () => {
    let fellBack = false;
    expect(() =>
      prayerTimes(TROMSO.lat, TROMSO.lng, '2026-06-21', { onPolarFallback: () => (fellBack = true) }),
    ).not.toThrow();
    expect(fellBack).toBe(true);

    const t = prayerTimes(TROMSO.lat, TROMSO.lng, '2026-06-21', {});
    for (const n of PRAYER_NAMES) expect(Number.isNaN(t[n].getTime())).toBe(false);
  });

  it('на обычных широтах фолбэк не срабатывает', () => {
    let fellBack = false;
    prayerTimes(SPB.lat, SPB.lng, '2026-06-21', { onPolarFallback: () => (fellBack = true) });
    expect(fellBack).toBe(false);
  });
});

describe('переход на зимнее время в Нью-Йорке', () => {
  const days = ['2026-10-31', '2026-11-01', '2026-11-02'];

  it('смещение зоны действительно меняется 1 ноября', () => {
    const offsets = days.map((d) => DateTime.fromISO(`${d}T12:00`, { zone: NEW_YORK.tz }).toFormat('ZZ'));
    expect(offsets).toEqual(['-04:00', '-05:00', '-05:00']);
  });

  it('у намаза сдвигается местное время, а момент в UTC почти нет', () => {
    const local = days.map((d) => localTimes(NEW_YORK, d).fajr);
    const utc = days.map((d) =>
      DateTime.fromJSDate(prayerTimes(NEW_YORK.lat, NEW_YORK.lng, d).fajr, { zone: 'utc' }).toFormat('HH:mm'),
    );

    // Местное время прыгает на час назад: фаджр — солнечное событие.
    expect(minutesApart(local[0], local[1])).toBeGreaterThan(50);
    // Момент в UTC между соседними днями меняется на считанные минуты.
    expect(minutesApart(utc[0], utc[1])).toBeLessThanOrEqual(5);
    expect(minutesApart(utc[1], utc[2])).toBeLessThanOrEqual(5);
  });

  it('у кастомной темы наоборот: местное время постоянно, UTC сдвигается на час', () => {
    const openUtc = days.map((d) =>
      DateTime.fromISO(`${d}T06:00`, { zone: NEW_YORK.tz }).toUTC().toFormat('HH:mm'),
    );
    expect(openUtc).toEqual(['10:00', '11:00', '11:00']);
  });

  it('окна намазов в эти дни корректны: открытие строго раньше закрытия', () => {
    for (const d of days) {
      for (const id of ['t2', 't3', 't4', 't5', 't6'] as const) {
        const w = namazWindow(NAMAZ_BY_ID.get(id)!, d, NEW_YORK.tz, lookupFor(NEW_YORK));
        expect(w.closesAt.getTime(), `${id} ${d}`).toBeGreaterThan(w.opensAt.getTime());
      }
    }
  });
});

describe('окна и ключи дня', () => {
  const lookup = lookupFor(BISHKEK);

  it('Куптан идёт до фаджра следующего дня', () => {
    const w = namazWindow(NAMAZ_BY_ID.get('t6')!, '2026-11-08', BISHKEK.tz, lookup);
    expect(toLocalDate(w.opensAt, BISHKEK.tz)).toBe('2026-11-08');
    expect(toLocalDate(w.closesAt, BISHKEK.tz)).toBe('2026-11-09');
    expect(w.dayKey).toBe('2026-11-08');
  });

  it('отчёт в 01:00 попадает в ключ предыдущего дня', () => {
    const at = DateTime.fromISO('2026-11-09T01:00', { zone: BISHKEK.tz }).toJSDate();
    const w = namazWindow(NAMAZ_BY_ID.get('t6')!, '2026-11-08', BISHKEK.tz, lookup);
    expect(w.opensAt.getTime()).toBeLessThanOrEqual(at.getTime());
    expect(at.getTime()).toBeLessThan(w.closesAt.getTime());
    expect(w.dayKey).toBe('2026-11-08');
  });

  it('Тахажуд не открывается раньше вчерашней иши', () => {
    const def = NAMAZ_BY_ID.get('t1')!;
    const w = namazWindow(def, '2026-11-09', BISHKEK.tz, lookup);
    const prevIsha = lookup(localDateShift('2026-11-09', -1)).isha;
    expect(w.opensAt.getTime()).toBeGreaterThanOrEqual(prevIsha.getTime());
    expect(w.dayKey).toBe('2026-11-09');
  });

  it('Тахажуд лежит внутри окна Куптана, но у них разные ключи дня', () => {
    const tahajjud = namazWindow(NAMAZ_BY_ID.get('t1')!, '2026-11-09', BISHKEK.tz, lookup);
    const isha = namazWindow(NAMAZ_BY_ID.get('t6')!, '2026-11-08', BISHKEK.tz, lookup);
    expect(tahajjud.opensAt.getTime()).toBeGreaterThanOrEqual(isha.opensAt.getTime());
    expect(tahajjud.closesAt.getTime()).toBeLessThanOrEqual(isha.closesAt.getTime());
    expect(tahajjud.dayKey).not.toBe(isha.dayKey);
  });
});
