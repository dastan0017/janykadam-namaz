import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { searchCities, type GeoHit } from '../db/geonames.repo';
import { locationPresets } from '../db/schema';
import { buildLocation, placeLabelWithOffset, utcOffsetLabel, type Location } from '../domain/location';
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
export class LocationService {
  private readonly log = new Logger(LocationService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

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

  /** Координаты из присланной геолокации: пояс только от geo-tz. */
  fromCoords(lat: number, lng: number, label: string): Location {
    return buildLocation({ lat, lng, placeLabel: label, countryCode: '', source: 'geo' });
  }
}
