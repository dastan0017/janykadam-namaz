import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { prayerTimesCache } from '../db/schema';
import { PRAYER_NAMES, prayerTimes, roundCoord, type PrayerInstants } from '../domain/prayer';
import type { PrayerLookup } from '../domain/windows';
import { SettingsService } from './settings.service';

/**
 * Времена намаза с кэшем в Postgres.
 *
 * Ключ — координаты, округлённые до 2 знаков, локальная дата и версия метода.
 * Поправки в настройках меняют версию, поэтому старые строки просто перестают
 * использоваться и не требуют очистки.
 */
@Injectable()
export class PrayerService {
  private readonly log = new Logger(PrayerService.name);

  /** Кэш в памяти поверх таблицы: один планировщик трогает одно место много раз. */
  private readonly memo = new Map<string, PrayerInstants>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  private key(lat: number, lng: number, localDate: string, version: string): string {
    return `${lat}|${lng}|${localDate}|${version}`;
  }

  async times(lat: number, lng: number, localDate: string): Promise<PrayerInstants> {
    const { prayerTune, methodVersion } = await this.settings.getSettings();
    const lat2 = roundCoord(lat);
    const lng2 = roundCoord(lng);
    const memoKey = this.key(lat2, lng2, localDate, methodVersion);

    const hit = this.memo.get(memoKey);
    if (hit) return hit;

    const [row] = await this.db
      .select()
      .from(prayerTimesCache)
      .where(
        and(
          eq(prayerTimesCache.lat2, lat2),
          eq(prayerTimesCache.lng2, lng2),
          eq(prayerTimesCache.localDate, localDate),
          eq(prayerTimesCache.methodVersion, methodVersion),
        ),
      )
      .limit(1);

    if (row) {
      const cached = {
        fajr: row.fajr, sunrise: row.sunrise, dhuhr: row.dhuhr,
        asr: row.asr, maghrib: row.maghrib, isha: row.isha,
      } satisfies PrayerInstants;
      this.memo.set(memoKey, cached);
      return cached;
    }

    const computed = prayerTimes(lat2, lng2, localDate, {
      tune: prayerTune,
      onPolarFallback: (info) =>
        this.log.warn(`Полярный фолбэк: ${info.lat},${info.lng} на ${info.localDate}`),
    });

    await this.db
      .insert(prayerTimesCache)
      .values({ lat2, lng2, localDate, methodVersion, ...computed })
      .onConflictDoNothing();

    this.memo.set(memoKey, computed);
    return computed;
  }

  /**
   * Готовит лукап для движка окон: окнам нужны соседние дни (Куптан тянется в
   * следующий, Тахажуд может открыться в предыдущем), поэтому прогреваем их разом.
   */
  async lookupFor(lat: number, lng: number, dates: string[]): Promise<PrayerLookup> {
    const { methodVersion } = await this.settings.getSettings();
    const lat2 = roundCoord(lat);
    const lng2 = roundCoord(lng);

    await Promise.all(dates.map((d) => this.times(lat2, lng2, d)));

    return (localDate: string): PrayerInstants => {
      const cached = this.memo.get(this.key(lat2, lng2, localDate, methodVersion));
      if (cached) return cached;
      // Дата вне прогретого набора — считаем на месте, это дёшево.
      return prayerTimes(lat2, lng2, localDate);
    };
  }

  /** Фоновая подготовка кэша на следующие дни для всех мест участниц. */
  async precompute(places: { lat: number; lng: number }[], dates: string[]): Promise<number> {
    let n = 0;
    for (const p of places) {
      for (const d of dates) {
        await this.times(p.lat, p.lng, d);
        n++;
      }
    }
    return n;
  }

  /** Сегодняшние шесть времён строкой: «Багымдат 06:19, Күн чыгуу 07:44…». */
  async formatDay(lat: number, lng: number, localDate: string, tz: string, labels: Record<string, string>): Promise<string> {
    const t = await this.times(lat, lng, localDate);
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false }).format(d);
    return PRAYER_NAMES.map((n) => `${labels[n] ?? n} ${fmt(t[n])}`).join(', ');
  }

  async clearCacheFor(methodVersionToDrop: string): Promise<void> {
    this.memo.clear();
    await this.db.delete(prayerTimesCache).where(sql`${prayerTimesCache.methodVersion} = ${methodVersionToDrop}`);
  }
}
