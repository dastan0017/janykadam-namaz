import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { normalizeForSearch } from '../domain/normalize';

export interface GeoHit {
  geonameid: number;
  name: string;
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
    SELECT geonameid, name, lat, lng, "countryCode", timezone, population, similarity
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
    lat: Number(r.lat),
    lng: Number(r.lng),
    countryCode: r.countryCode,
    timezone: r.timezone,
    population: Number(r.population),
    similarity: Number(r.similarity),
  }));
}
