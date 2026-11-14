import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray, like, or } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { nearestCity, searchCities, type GeoHit } from '../db/geonames.repo';
import { BOT_TEXTS } from '../db/seed-texts';
import { locationPresets, participants } from '../db/schema';
import { buildLocation, placeLabelWithOffset, tzFromCoords, utcOffsetLabel, type Location } from '../domain/location';
import { displayCityName } from '../domain/normalize';
import type { Lang } from '../domain/text';

export interface PresetView {
  id: string;
  /** Подпись с текущим смещением: «Бишкек · UTC+6». */
  label: string;
  lat: number;
  lng: number;
  tz: string;
  labelRu: string;
  labelKg: string;
}

@Injectable()
export class LocationService implements OnModuleInit {
  private readonly log = new Logger(LocationService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** При старте чиним места, сохранённые до того, как геолокацию стали превращать в город. */
  async onModuleInit(): Promise<void> {
    try {
      const n = await this.healGeoLabels();
      if (n) this.log.log(`Город по геолокации проставлен участницам: ${n}`);
    } catch (err) {
      this.log.warn(`Не удалось починить места по геолокации: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Раньше вместо города по геолокации сохранялась надпись кнопки
   * «📍 Отправить геолокацию» — и она попадала в подпись отчёта в канале.
   * Находим такие места и ставим ближайший город по координатам.
   */
  async healGeoLabels(): Promise<number> {
    const buttonLabels = BOT_TEXTS.filter((t) => t.key === 'btn_send_location').flatMap((t) => [t.ru, t.kg]);
    const rows = await this.db
      .select({ id: participants.id, lat: participants.lat, lng: participants.lng, label: participants.placeLabel })
      .from(participants)
      .where(
        and(
          eq(participants.locationSource, 'geo'),
          or(inArray(participants.placeLabel, buttonLabels), like(participants.placeLabel, '📍%'), eq(participants.placeLabel, '')),
        ),
      );

    let fixed = 0;
    for (const r of rows) {
      if (r.lat == null || r.lng == null) continue;
      const hit = await nearestCity(this.db, r.lat, r.lng);
      if (!hit) continue;
      await this.db
        .update(participants)
        .set({ placeLabel: displayCityName(hit), countryCode: hit.countryCode })
        .where(eq(participants.id, r.id));
      fixed++;
    }
    return fixed;
  }

  /** Города-пресеты с актуальным смещением: зимой Нью-Йорк UTC−5, летом UTC−4. */
  async presets(lang: Lang, at: Date = new Date()): Promise<PresetView[]> {
    const rows = await this.db.select().from(locationPresets).orderBy(asc(locationPresets.position));
    return rows.map((r) => {
      const name = lang === 'kg' ? r.labelKg : r.labelRu;
      return {
        id: r.id,
        label: `${name} · ${utcOffsetLabel(r.tz, at)}`,
        lat: r.lat,
        lng: r.lng,
        tz: r.tz,
        labelRu: r.labelRu,
        labelKg: r.labelKg,
      };
    });
  }

  /** Находит пресет по нажатой кнопке реплай-клавиатуры. */
  async presetByLabel(label: string, lang: Lang): Promise<PresetView | undefined> {
    const list = await this.presets(lang);
    return list.find((p) => p.label === label || p.labelRu === label || p.labelKg === label);
  }

  async search(query: string, limit = 6): Promise<GeoHit[]> {
    return searchCities(this.db, query, limit);
  }

  /** Подпись результата поиска: «Талас, Кыргызстан · UTC+6». */
  hitLabel(hit: GeoHit, lang: Lang, at: Date = new Date(), query?: string): string {
    const name = displayCityName(hit, query);
    return placeLabelWithOffset(name, hit.countryCode, hit.timezone, lang === 'kg' ? 'ky' : 'ru', at);
  }

  /** Как показать город: кириллица, если она доказуемо то же название. */
  displayName(hit: GeoHit, query?: string): string {
    return displayCityName(hit, query);
  }

  fromPreset(preset: PresetView, lang: Lang): Location {
    return buildLocation({
      lat: preset.lat,
      lng: preset.lng,
      placeLabel: lang === 'kg' ? preset.labelKg : preset.labelRu,
      countryCode: '',
      source: 'preset',
      declaredTz: preset.tz,
      onTzMismatch: (i) => this.log.warn(`Пресет: пояс из базы ${i.declared}, geo-tz даёт ${i.actual} для ${i.lat},${i.lng}`),
    });
  }

  fromHit(hit: GeoHit): Location {
    return buildLocation({
      lat: hit.lat,
      lng: hit.lng,
      placeLabel: hit.name,
      countryCode: hit.countryCode,
      source: 'search',
      declaredTz: hit.timezone,
      onTzMismatch: (i) => this.log.warn(`GeoNames: пояс ${i.declared}, geo-tz даёт ${i.actual} для ${i.lat},${i.lng}`),
    });
  }

  /**
   * Координаты из присланной геолокации: пояс только от geo-tz, а подпись —
   * ближайший город. Его видят в подписи отчёта в канале и в «Калтыруу: …».
   */
  async fromCoords(lat: number, lng: number): Promise<Location> {
    const hit = await nearestCity(this.db, lat, lng).catch(() => null);
    return buildLocation({
      lat,
      lng,
      placeLabel: hit ? displayCityName(hit) : cityOfZone(tzFromCoordsSafe(lat, lng)),
      countryCode: hit?.countryCode ?? '',
      source: 'geo',
    });
  }
}

/** Ничего рядом в GeoNames — хотя бы город пояса: «Asia/Bishkek» → «Bishkek». */
function cityOfZone(tz: string): string {
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? '';
}

function tzFromCoordsSafe(lat: number, lng: number): string {
  try {
    return tzFromCoords(lat, lng);
  } catch {
    return '';
  }
}
