import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { normalizeForSearch } from '../domain/normalize';

export interface GeoHit {
  geonameid: number;
  name: string;
  /** Сырой список альтернативных названий: из него берём кириллическую форму. */
  alternatenames: string;
  lat: number;
  lng: number;
  countryCode: string;
  timezone: string;
  population: number;
  similarity: number;
}

/** Сырая строка из драйвера: числа приходят строками. */
interface GeoRow extends Record<string, unknown> {
  geonameid: number;
  name: string;
  alternatenames: string;
  lat: string | number;
  lng: string | number;
  countryCode: string;
  timezone: string;
  population: string | number;
  similarity: string | number;
}

/**
 * Поиск города по названию.
 *
 * Ранжирование в три яруса, внутри яруса — по населению:
 *  2. запрос точно совпал с основным именем города;
 *  1. запрос совпал с отдельным словом среди альтернативных названий;
 *  0. остальное — по близости триграмм.
 *
 * Ярусы нужны потому, что alternatenames у крупных городов огромны и содержат
 * посторонние транслитерации: слово «osh» встречается и у Лондона, и у Найроби.
 * Без приоритета основного имени Ош утонул бы под городами-миллионниками.
 */
export async function searchCities(db: NodePgDatabase<Record<string, unknown>>, query: string, limit = 6): Promise<GeoHit[]> {
  const q = normalizeForSearch(query);
  if (q.length < 2) return [];

  const rows = await db.execute<GeoRow>(sql`
    WITH scored AS (
      SELECT geonameid,
             name,
             alternatenames,
             lat,
             lng,
             country_code AS "countryCode",
             timezone,
             population,
             similarity(search_text, ${q}) AS similarity,
             CASE
               WHEN name_norm = ${q} OR name_norm LIKE ${`${q} %`} OR name_norm LIKE ${`% ${q}`} THEN 2
               WHEN search_text = ${q}
                 OR search_text LIKE ${`${q} %`}
                 OR search_text LIKE ${`% ${q}`}
                 OR search_text LIKE ${`% ${q} %`} THEN 1
               ELSE 0
             END AS tier
      FROM geonames
      WHERE search_text % ${q}
         OR search_text LIKE ${`%${q}%`}
    )
    SELECT geonameid, name, alternatenames, lat, lng, "countryCode", timezone, population, similarity
    FROM scored
    ORDER BY
      tier DESC,
      CASE WHEN tier > 0 THEN population ELSE 0 END DESC,
      similarity DESC,
      population DESC
    LIMIT ${limit}
  `);

  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as GeoRow[];
  return list.map((r) => ({
    geonameid: Number(r.geonameid),
    name: r.name,
    alternatenames: r.alternatenames ?? '',
    lat: Number(r.lat),
    lng: Number(r.lng),
    countryCode: r.countryCode,
    timezone: r.timezone,
    population: Number(r.population),
    similarity: Number(r.similarity),
  }));
}

/** Крупный город ближе этого — показываем его, а не соседнее село. */
const BIG_CITY_RADIUS_KM = 15;

/**
 * Город по координатам — для присланной геолокации.
 *
 * Берём точки GeoNames в небольшом квадрате вокруг: если в 15 км есть город,
 * побеждает самый населённый (окраина Бишкека — это Бишкек, а не посёлок
 * рядом); иначе — ближайший населённый пункт. Ничего рядом нет — null.
 */
export async function nearestCity(db: NodePgDatabase<Record<string, unknown>>, lat: number, lng: number): Promise<GeoHit | null> {
  const rows = await db.execute<GeoRow & { km: string | number }>(sql`
    SELECT geonameid, name, alternatenames, lat, lng,
           country_code AS "countryCode", timezone, population, 0 AS similarity,
           111.2 * sqrt(power(lat - ${lat}, 2) + power((lng - ${lng}) * cos(radians(${lat})), 2)) AS km
    FROM geonames
    WHERE lat BETWEEN ${lat - 0.6} AND ${lat + 0.6}
      AND lng BETWEEN ${lng - 0.9} AND ${lng + 0.9}
    ORDER BY km
    LIMIT 40
  `);

  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as (GeoRow & { km: string | number })[];
  const hits = list.map((r) => ({
    geonameid: Number(r.geonameid),
    name: r.name,
    alternatenames: r.alternatenames,
    lat: Number(r.lat),
    lng: Number(r.lng),
    countryCode: r.countryCode,
    timezone: r.timezone,
    population: Number(r.population),
    similarity: 0,
    km: Number(r.km),
  }));
  if (hits.length === 0) return null;

  const near = hits.filter((h) => h.km <= BIG_CITY_RADIUS_KM);
  const best = near.length ? near.reduce((a, b) => (b.population > a.population ? b : a)) : hits[0];
  return {
    geonameid: best.geonameid,
    name: best.name,
    alternatenames: best.alternatenames,
    lat: best.lat,
    lng: best.lng,
    countryCode: best.countryCode,
    timezone: best.timezone,
    population: best.population,
    similarity: 0,
  };
}
