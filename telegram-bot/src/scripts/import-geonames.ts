import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Pool } from 'pg';
import { buildNameNorm, buildSearchText } from '../domain/normalize';

/**
 * Импорт GeoNames cities1000 (CC BY 4.0, https://www.geonames.org/).
 * Атрибуция обязана остаться в README и в тексте /help.
 *
 * Файл скачивается один раз в data/geonames и дальше переиспользуется.
 */

const URL = 'https://download.geonames.org/export/dump/cities1000.zip';
const DIR = 'data/geonames';
const ZIP = `${DIR}/cities1000.zip`;
const TXT = `${DIR}/cities1000.txt`;

/** Колонки cities1000.txt — табулированный формат GeoNames. */
const enum Col {
  GeonameId = 0,
  Name = 1,
  AsciiName = 2,
  AlternateNames = 3,
  Latitude = 4,
  Longitude = 5,
  CountryCode = 8,
  Admin1 = 10,
  Population = 14,
  Timezone = 17,
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(): Promise<void> {
  if (await exists(TXT)) {
    console.log(`${TXT} уже на месте — скачивание пропущено.`);
    return;
  }
  await mkdir(DIR, { recursive: true });

  if (!(await exists(ZIP))) {
    console.log(`Скачиваю ${URL} …`);
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`GeoNames ответил ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await (await import('node:fs/promises')).writeFile(ZIP, buf);
    console.log(`Скачано: ${(buf.length / 1024 / 1024).toFixed(1)} МБ`);
  }

  // unzip есть в macOS и в образе из Dockerfile.
  execFileSync('unzip', ['-o', ZIP, '-d', DIR], { stdio: 'inherit' });
  await rm(ZIP, { force: true });
}

interface Row {
  geonameid: number;
  name: string;
  asciiname: string;
  alternatenames: string;
  nameNorm: string;
  searchText: string;
  lat: number;
  lng: number;
  countryCode: string;
  admin1: string;
  population: number;
  timezone: string;
}

function parse(line: string): Row | null {
  const f = line.split('\t');
  if (f.length < 18) return null;

  const geonameid = Number(f[Col.GeonameId]);
  const lat = Number(f[Col.Latitude]);
  const lng = Number(f[Col.Longitude]);
  if (!Number.isFinite(geonameid) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const name = f[Col.Name] ?? '';
  const asciiname = f[Col.AsciiName] ?? '';
  const alternatenames = f[Col.AlternateNames] ?? '';

  return {
    geonameid,
    name,
    asciiname,
    alternatenames,
    nameNorm: buildNameNorm({ name, asciiname }),
    searchText: buildSearchText({ name, asciiname, alternatenames }),
    lat,
    lng,
    countryCode: f[Col.CountryCode] ?? '',
    admin1: f[Col.Admin1] ?? '',
    population: Number(f[Col.Population]) || 0,
    timezone: f[Col.Timezone] ?? '',
  };
}

const BATCH = 1000;

async function flush(pool: Pool, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;

  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const o = i * 12;
    values.push(
      r.geonameid, r.name, r.asciiname, r.alternatenames, r.nameNorm, r.searchText,
      r.lat, r.lng, r.countryCode, r.admin1, r.population, r.timezone,
    );
    return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12})`;
  });

  await pool.query(
    `INSERT INTO geonames
       (geonameid, name, asciiname, alternatenames, name_norm, search_text, lat, lng, country_code, admin1, population, timezone)
     VALUES ${tuples.join(',')}
     ON CONFLICT (geonameid) DO UPDATE SET
       name = EXCLUDED.name,
       asciiname = EXCLUDED.asciiname,
       alternatenames = EXCLUDED.alternatenames,
       name_norm = EXCLUDED.name_norm,
       search_text = EXCLUDED.search_text,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       country_code = EXCLUDED.country_code,
       admin1 = EXCLUDED.admin1,
       population = EXCLUDED.population,
       timezone = EXCLUDED.timezone`,
    values,
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Нужен DATABASE_URL');

  await download();

  const pool = new Pool({ connectionString: url });
  const rl = createInterface({ input: createReadStream(TXT, 'utf8'), crlfDelay: Infinity });

  let batch: Row[] = [];
  let total = 0;

  for await (const line of rl) {
    const row = parse(line);
    if (!row) continue;
    batch.push(row);
    if (batch.length >= BATCH) {
      await flush(pool, batch);
      total += batch.length;
      batch = [];
      if (total % 20_000 === 0) console.log(`  …${total}`);
    }
  }
  await flush(pool, batch);
  total += batch.length;

  await pool.query('ANALYZE geonames');
  await pool.end();
  console.log(`Импортировано городов: ${total}. Источник: GeoNames (CC BY 4.0).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
