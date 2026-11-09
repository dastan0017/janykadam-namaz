import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchCities } from '../src/db/geonames.repo';

/**
 * Поиск городов на настоящей базе. Требует импортированный GeoNames
 * (pnpm import:geonames) и DATABASE_URL.
 */

const url = process.env.DATABASE_URL ?? 'postgres://janykadam:janykadam@localhost:5433/janykadam';

let pool: Pool;
let db: NodePgDatabase<Record<string, unknown>>;
let ready = false;

beforeAll(async () => {
  pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    const r = await pool.query('SELECT count(*)::int AS n FROM geonames');
    ready = (r.rows[0]?.n ?? 0) > 1000;
  } catch {
    ready = false;
  }
  db = drizzle(pool);
});

afterAll(async () => {
  await pool?.end();
});

const skipIfEmpty = () => {
  if (!ready) throw new Error('GeoNames не импортирован: запустите pnpm import:geonames');
};

describe('поиск городов', () => {
  it('«талас» находит Талас в Кыргызстане', async () => {
    skipIfEmpty();
    const hits = await searchCities(db, 'талас');
    const kg = hits.find((h) => h.countryCode === 'KG');
    expect(kg, `нашли: ${hits.map((h) => `${h.name}/${h.countryCode}`).join(', ')}`).toBeDefined();
    expect(kg!.timezone).toBe('Asia/Bishkek');
  });

  it('латиницей «Talas» — тот же город', async () => {
    skipIfEmpty();
    const hits = await searchCities(db, 'Talas');
    const kg = hits.find((h) => h.countryCode === 'KG');
    expect(kg).toBeDefined();
    expect(kg!.timezone).toBe('Asia/Bishkek');
  });

  it('опечатка «Бишкэк» находит Бишкек', async () => {
    skipIfEmpty();
    const hits = await searchCities(db, 'Бишкэк');
    const bishkek = hits.find((h) => h.countryCode === 'KG' && h.timezone === 'Asia/Bishkek');
    expect(bishkek, `нашли: ${hits.map((h) => h.name).join(', ')}`).toBeDefined();
    expect(bishkek!.population).toBeGreaterThan(100_000);
  });

  it('«Ош» находит Ош с поясом Asia/Bishkek', async () => {
    skipIfEmpty();
    const hits = await searchCities(db, 'Ош');
    const osh = hits.find((h) => h.countryCode === 'KG');
    expect(osh).toBeDefined();
    expect(osh!.timezone).toBe('Asia/Bishkek');
  });

  it('кыргызское написание «Жалал-Абад» находится', async () => {
    skipIfEmpty();
    const hits = await searchCities(db, 'Жалал-Абад');
    expect(hits.some((h) => h.countryCode === 'KG')).toBe(true);
  });

  it('«Москва» находит Москву', async () => {
    skipIfEmpty();
    const hits = await searchCities(db, 'Москва');
    const moscow = hits.find((h) => h.countryCode === 'RU' && h.timezone === 'Europe/Moscow');
    expect(moscow).toBeDefined();
  });

  it('возвращает не больше шести результатов', async () => {
    skipIfEmpty();
    const hits = await searchCities(db, 'san');
    expect(hits.length).toBeLessThanOrEqual(6);
  });

  it('слишком короткий запрос ничего не ищет', async () => {
    skipIfEmpty();
    expect(await searchCities(db, 'а')).toEqual([]);
  });
});
