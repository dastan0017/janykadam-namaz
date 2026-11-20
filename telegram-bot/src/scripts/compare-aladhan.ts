import { DateTime } from 'luxon';
import { PRAYER_NAMES, prayerTimes, type PrayerName } from '../domain/prayer';

/**
 * Сверка локального движка с Aladhan API.
 *
 * Инструмент разработчика: в рантайме бот никогда не ходит в сеть за временем
 * намаза. Нужен, чтобы убедиться, что метод 14 (ДУМ России) и ханафитский Аср
 * у нас настроены так же, как в эталоне.
 */

const CITIES = [
  { name: 'Бишкек', lat: 42.8746, lng: 74.5698, tz: 'Asia/Bishkek' },
  { name: 'Ош', lat: 40.5283, lng: 72.7985, tz: 'Asia/Bishkek' },
  { name: 'Москва', lat: 55.7558, lng: 37.6173, tz: 'Europe/Moscow' },
  { name: 'Стамбул', lat: 41.0082, lng: 28.9784, tz: 'Europe/Istanbul' },
  { name: 'Нью-Йорк', lat: 40.7128, lng: -74.006, tz: 'America/New_York' },
  { name: 'Сеул', lat: 37.5665, lng: 126.978, tz: 'Asia/Seoul' },
];

const ALADHAN_KEY: Record<PrayerName, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

async function fetchAladhan(lat: number, lng: number, date: string): Promise<Record<string, string>> {
  const [y, m, d] = date.split('-');
  const url = `https://api.aladhan.com/v1/timings/${d}-${m}-${y}?latitude=${lat}&longitude=${lng}&method=14&school=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Aladhan ответил ${res.status}`);
  const json = (await res.json()) as { data: { timings: Record<string, string> } };
  return json.data.timings;
}

async function main(): Promise<void> {
  const date = process.argv[2] ?? DateTime.utc().toFormat('yyyy-MM-dd');
  console.log(`Сверка с Aladhan (method=14, school=1) на ${date}\n`);

  let worst = 0;

  for (const city of CITIES) {
    const mine = prayerTimes(city.lat, city.lng, date);
    let theirs: Record<string, string>;
    try {
      theirs = await fetchAladhan(city.lat, city.lng, date);
    } catch (err) {
      console.log(`${city.name}: не удалось получить эталон — ${(err as Error).message}\n`);
      continue;
    }

    console.log(city.name);
    for (const n of PRAYER_NAMES) {
      const ours = DateTime.fromJSDate(mine[n], { zone: city.tz }).toFormat('HH:mm');
      const ref = (theirs[ALADHAN_KEY[n]] ?? '').slice(0, 5);
      const diff = ref ? diffMinutes(ours, ref) : NaN;
      if (Number.isFinite(diff)) worst = Math.max(worst, Math.abs(diff));
      const mark = !Number.isFinite(diff) ? '?' : Math.abs(diff) <= 1 ? ' ' : '!';
      console.log(`  ${mark} ${n.padEnd(8)} у нас ${ours}   Aladhan ${ref || '—'}   ${Number.isFinite(diff) ? `${diff > 0 ? '+' : ''}${diff} мин` : ''}`);
    }
    console.log();
  }

  console.log(`Максимальное расхождение: ${worst} мин.`);
}

function diffMinutes(a: string, b: string): number {
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return toMin(a) - toMin(b);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
